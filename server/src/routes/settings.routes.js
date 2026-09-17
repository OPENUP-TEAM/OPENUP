import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';
import { invalidateSetting } from '../services/settings.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------
// Module: System Settings (Christine Joyce Ravanes)
//   1. Manage Configurations  2. Manage Roles & Permissions
//   3. Backup & Maintenance
//
// Module: AI Crisis Management (Noe Tobes)
//   1. Configure Escalation Rules  2. Manage Emergency Contacts
// ---------------------------------------------------------------------

/**
 * Every setting the system reads, declared here rather than discovered.
 *
 * The services already read these keys from system_setting and fall back
 * to defaults when a row is missing. Listing them means the admin screen
 * can show what exists, what it does, and what happens if it is unset,
 * instead of being a free-text key-value editor nobody dares touch.
 */
const SETTINGS = {
  crisis_hotlines: {
    label: 'Crisis hotlines',
    group: 'crisis',
    help: 'Shown to a resident whenever a crisis is detected, and on the companion start screen. Ordered as listed.',
    schema: z.array(z.object({
      name: z.string().trim().min(2).max(60),
      number: z.string().trim().min(3).max(30),
      note: z.string().trim().max(80).optional().or(z.literal('')),
    })).min(1, 'Keep at least one number. This is what a resident in danger sees.'),
    fallback: [
      { name: 'NCMH Crisis Hotline', number: '1553', note: 'Free, 24/7, landline and mobile' },
      { name: 'Hopeline PH', number: '0917-558-4673', note: '24/7' },
      { name: 'Emergency', number: '911', note: 'If someone is in immediate danger' },
    ],
  },
  ai_escalation_threshold: {
    label: 'Escalation threshold',
    group: 'crisis',
    help: 'Risk score above which an alert is raised. High and severe always escalate regardless of this number, so lowering it only affects moderate cases.',
    schema: z.object({ risk_score: z.coerce.number().min(0.1).max(1) }),
    fallback: { risk_score: 0.75 },
  },
  session_window: {
    label: 'Session room window',
    group: 'sessions',
    help: 'How long before a session the room opens, and how long after it closes. A shorter window means a leaked room name is useful for less time.',
    schema: z.object({
      open_before_min: z.coerce.number().int().min(0).max(120),
      close_after_min: z.coerce.number().int().min(15).max(480),
    }),
    fallback: { open_before_min: 15, close_after_min: 90 },
  },
  booking_rules: {
    label: 'Booking rules',
    group: 'sessions',
    help: 'Limits applied when a resident books.',
    schema: z.object({
      duration_min: z.coerce.number().int().min(15).max(180),
      max_days_ahead: z.coerce.number().int().min(1).max(90),
    }),
    fallback: { duration_min: 60, max_days_ahead: 14 },
  },
};

/** 1. Manage Configurations — current values, with fallbacks made visible. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT s.key, s.value, s.updated_at, u.name AS updated_by_name
         FROM system_setting s
         LEFT JOIN "user" u ON u.user_id = s.updated_by`
    );
    const stored = Object.fromEntries(rows.map((r) => [r.key, r]));

    res.json({
      settings: Object.entries(SETTINGS).map(([key, def]) => ({
        key,
        label: def.label,
        group: def.group,
        help: def.help,
        value: stored[key]?.value ?? def.fallback,
        is_default: !stored[key],
        updated_at: stored[key]?.updated_at ?? null,
        updated_by_name: stored[key]?.updated_by_name ?? null,
      })),
    });
  })
);

router.put(
  '/:key',
  asyncHandler(async (req, res) => {
    const def = SETTINGS[req.params.key];
    if (!def) throw ApiError.notFound('No such setting.');

    let value;
    try {
      value = def.schema.parse(req.body.value);
    } catch (err) {
      throw ApiError.badRequest(
        err.issues?.[0]?.message ?? 'That value is not valid for this setting.'
      );
    }

    const { rows } = await query(
      `INSERT INTO system_setting (key, value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING key, value, updated_at`,
      [req.params.key, JSON.stringify(value), req.user.user_id]
    );

    // Drop the cached copy so the change is live, not live in 30 seconds.
    invalidateSetting(req.params.key);

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'setting.update', 'system_setting', NULL, $2)`,
      [req.user.user_id, { key: req.params.key }]
    );

    res.json({ setting: rows[0] });
  })
);

/** Back to the built-in default by deleting the row. */
router.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    if (!SETTINGS[req.params.key]) throw ApiError.notFound('No such setting.');
    await query('DELETE FROM system_setting WHERE key = $1', [req.params.key]);
    invalidateSetting(req.params.key);
    res.json({ ok: true, value: SETTINGS[req.params.key].fallback });
  })
);

// ---------------------------------------------------------------------
// 2. Manage Roles & Permissions
// ---------------------------------------------------------------------

/**
 * Roles are fixed in the schema, not configurable.
 *
 * A role editor would let an administrator grant residents access to
 * clinical notes or LGU analytics by mistake, and every route already
 * checks a specific role name. So this reports what each role can reach,
 * generated from how the routes are actually guarded, and allows the one
 * change that is genuinely needed: promoting someone to administrator.
 */
const PERMISSIONS = [
  { area: 'Own mood, journal, assessments', resident: true,  psychologist: false, lgu: false, admin: false },
  { area: 'Book and cancel sessions',        resident: true,  psychologist: false, lgu: false, admin: false },
  { area: 'Anonymous chat',                  resident: true,  psychologist: true,  lgu: false, admin: false },
  { area: 'Accept and run sessions',         resident: false, psychologist: true,  lgu: false, admin: false },
  { area: 'Write session notes',             resident: false, psychologist: true,  lgu: false, admin: false },
  { area: 'Escalate a live session',         resident: false, psychologist: true,  lgu: false, admin: false },
  { area: 'Barangay analytics (aggregate)',  resident: false, psychologist: false, lgu: true,  admin: true },
  { area: 'Assign Care Credits to residents',resident: false, psychologist: false, lgu: true,  admin: false },
  { area: 'Allocate credits to a barangay',  resident: false, psychologist: false, lgu: false, admin: true },
  { area: 'Verify psychologist licenses',    resident: false, psychologist: false, lgu: false, admin: true },
  { area: 'Suspend and delete accounts',     resident: false, psychologist: false, lgu: false, admin: true },
  { area: 'Moderate community content',      resident: false, psychologist: false, lgu: false, admin: true },
  { area: 'Change system settings',          resident: false, psychologist: false, lgu: false, admin: true },
];

router.get(
  '/roles/permissions',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT role, COUNT(*)::int AS n FROM "user"
        WHERE status = 'active' GROUP BY role`
    );
    res.json({
      permissions: PERMISSIONS,
      counts: Object.fromEntries(rows.map((r) => [r.role, r.n])),
      note: 'Roles are defined in the schema and enforced per route. They are not editable here by design.',
    });
  })
);

/** Promote or demote an administrator. */
router.patch(
  '/roles/:userId',
  asyncHandler(async (req, res) => {
    const { role } = z
      .object({ role: z.enum(['admin', 'resident']) })
      .parse(req.body);

    if (Number(req.params.userId) === Number(req.user.user_id))
      throw ApiError.badRequest('You cannot change your own role.');

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT user_id, name, role FROM "user" WHERE user_id = $1`,
        [req.params.userId]
      );
      const u = rows[0];
      if (!u) throw ApiError.notFound('No such user.');

      // Psychologists and LGU accounts carry linked records and barangay
      // scope; switching them would orphan those.
      if (!['admin', 'resident'].includes(u.role))
        throw ApiError.badRequest(
          'Only residents and administrators can change role. A psychologist or LGU account has linked records that would be orphaned.'
        );

      if (u.role === 'admin' && role === 'resident') {
        const { rows: admins } = await client.query(
          `SELECT COUNT(*)::int AS n FROM "user"
            WHERE role = 'admin' AND status = 'active' AND user_id <> $1`,
          [u.user_id]
        );
        if (admins[0].n === 0)
          throw ApiError.badRequest('This is the only active administrator.');
      }

      await client.query('UPDATE "user" SET role = $2 WHERE user_id = $1',
        [u.user_id, role]);

      await notify(client, u.user_id,
        role === 'admin'
          ? 'You have been given administrator access.'
          : 'Your administrator access has been removed.',
        'system', null);

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'role.change', 'user', $2, $3)`,
        [req.user.user_id, u.user_id, { from: u.role, to: role }]
      );

      return u;
    });

    res.json({ ok: true, user_id: updated.user_id, role });
  })
);

// ---------------------------------------------------------------------
// 3. Backup & Maintenance
// ---------------------------------------------------------------------

/**
 * What maintenance actually means here.
 *
 * Database backups are Supabase's job — the application cannot run
 * pg_dump against a managed instance, and pretending otherwise would give
 * an administrator a "Back up now" button that does nothing. So this
 * reports table sizes, flags rows that need attention, and exposes the
 * audit log, which is the part the application genuinely owns.
 */
router.get(
  '/maintenance',
  asyncHandler(async (_req, res) => {
    const [counts, stale, storage] = await Promise.all([
      query(`
        SELECT 'residents' AS item, COUNT(*)::int AS n FROM "user" WHERE role = 'resident'
        UNION ALL SELECT 'psychologists', COUNT(*)::int FROM psychologist
        UNION ALL SELECT 'bookings', COUNT(*)::int FROM booking
        UNION ALL SELECT 'mood entries', COUNT(*)::int FROM mood_entry
        UNION ALL SELECT 'voice journals', COUNT(*)::int FROM voice_journal
        UNION ALL SELECT 'assessments', COUNT(*)::int FROM assessment
        UNION ALL SELECT 'messages', COUNT(*)::int FROM message
        UNION ALL SELECT 'crisis alerts', COUNT(*)::int FROM crisis_alert
        UNION ALL SELECT 'audit entries', COUNT(*)::int FROM audit_log
      `),
      query(`
        SELECT 'expired subscriptions still active' AS issue, COUNT(*)::int AS n
          FROM subscription
         WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE
        UNION ALL
        SELECT 'credits past expiry still available', COUNT(*)::int
          FROM care_credit
         WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at < now()
        UNION ALL
        SELECT 'crisis alerts open over 7 days', COUNT(*)::int
          FROM crisis_alert
         WHERE status = 'open' AND created_at < now() - INTERVAL '7 days'
        UNION ALL
        SELECT 'journals stuck mid-pipeline', COUNT(*)::int
          FROM voice_journal
         WHERE status NOT IN ('ready', 'failed') AND created_at < now() - INTERVAL '1 hour'
        UNION ALL
        SELECT 'psychologists pending over 14 days', COUNT(*)::int
          FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
         WHERE u.status = 'pending' AND u.created_at < now() - INTERVAL '14 days'
      `),
      query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
    ]);

    res.json({
      counts: counts.rows,
      issues: stale.rows.filter((r) => r.n > 0),
      database_size: storage.rows[0].size,
      backups: {
        managed_by: 'Supabase',
        note: 'Daily automatic backups are taken by Supabase. Point-in-time recovery is available on paid plans. The application cannot run pg_dump against a managed instance, so there is no backup button here.',
      },
    });
  })
);

/** Fix the housekeeping items the maintenance check found. */
router.post(
  '/maintenance/run',
  asyncHandler(async (req, res) => {
    const { task } = z
      .object({ task: z.enum(['expire_subscriptions', 'expire_credits', 'fail_stuck_journals']) })
      .parse(req.body);

    let affected = 0;

    if (task === 'expire_subscriptions') {
      const r = await query(
        `UPDATE subscription SET status = 'expired'
          WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`
      );
      affected = r.rowCount;
    }

    if (task === 'expire_credits') {
      // Only unassigned or unused credits. A reserved credit is holding a
      // booked session and must not be expired out from under it.
      const r = await query(
        `UPDATE care_credit SET status = 'expired'
          WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at < now()`
      );
      affected = r.rowCount;
    }

    if (task === 'fail_stuck_journals') {
      const r = await query(
        `UPDATE voice_journal
            SET status = 'failed',
                error_detail = 'Processing did not complete. The recording is still saved.'
          WHERE status NOT IN ('ready', 'failed') AND created_at < now() - INTERVAL '1 hour'`
      );
      affected = r.rowCount;
    }

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'maintenance.run', NULL, NULL, $2)`,
      [req.user.user_id, { task, affected }]
    );

    res.json({ ok: true, task, affected });
  })
);

/** The audit log, which is what makes any of the above accountable. */
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const action = req.query.action || null;

    const { rows } = await query(
      `SELECT a.log_id, a.action, a.entity, a.entity_id, a.meta, a.created_at,
              u.name AS actor_name, u.role AS actor_role
         FROM audit_log a
         LEFT JOIN "user" u ON u.user_id = a.actor_id
        WHERE ($1::text IS NULL OR a.action LIKE $1 || '%')
        ORDER BY a.created_at DESC
        LIMIT $2`,
      [action, limit]
    );

    const { rows: actions } = await query(
      `SELECT split_part(action, '.', 1) AS prefix, COUNT(*)::int AS n
         FROM audit_log GROUP BY prefix ORDER BY prefix`
    );

    res.json({ entries: rows, action_groups: actions });
  })
);

// ---------------------------------------------------------------------
// AI Crisis Management — 2. Manage Emergency Contacts
// ---------------------------------------------------------------------

/**
 * How the crisis path is performing, so the thresholds above are tuned
 * against evidence rather than instinct.
 */
router.get(
  '/crisis/overview',
  asyncHandler(async (_req, res) => {
    const [bySource, recent, unresolved] = await Promise.all([
      query(
        `SELECT source, risk_level, COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                COUNT(*) FILTER (WHERE was_helpful IS TRUE)::int AS confirmed_helpful
           FROM crisis_alert
          GROUP BY source, risk_level
          ORDER BY source, risk_level`
      ),
      query(
        `SELECT date_trunc('week', created_at)::date AS week, COUNT(*)::int AS n
           FROM crisis_alert
          WHERE created_at >= now() - INTERVAL '8 weeks'
          GROUP BY week ORDER BY week`
      ),
      query(
        `SELECT COUNT(*)::int AS n,
                MIN(created_at) AS oldest
           FROM crisis_alert WHERE status = 'open'`
      ),
    ]);

    res.json({
      by_source: bySource.rows,
      weekly: recent.rows,
      open: unresolved.rows[0],
    });
  })
);

export default router;
