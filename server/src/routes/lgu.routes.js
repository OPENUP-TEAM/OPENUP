import { Router } from 'express';
import { query } from '../config/db.js';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../utils/http.js';
import { notify } from '../services/notification.service.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('lgu', 'admin'));

// Module: LGU Dashboard — "Your Barangay" panel (Figure 40).
router.get('/dashboard', asyncHandler(async (req, res) => {
  const barangayId = req.user.barangay_id;
  const [residents, credits, index, alerts] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM "user"
            WHERE barangay_id = $1 AND role = 'resident' AND status = 'active'`, [barangayId]),
    query('SELECT * FROM v_barangay_budget WHERE barangay_id = $1', [barangayId]),
    query('SELECT * FROM v_community_wellness_index WHERE barangay_id = $1', [barangayId]),
    query(`SELECT COUNT(*)::int AS n
             FROM crisis_alert c JOIN "user" u ON u.user_id = c.user_id
            WHERE u.barangay_id = $1 AND c.status = 'open'`, [barangayId]),
  ]);

  res.json({
    barangay_id: barangayId,
    registered_residents: residents.rows[0].n,
    high_risk_open: alerts.rows[0].n,
    budget: credits.rows[0] ?? null,
    wellness: index.rows[0] ?? null,
  });
}));

// Module: Community Wellness Index — 2. Compare by Period.
router.get('/wellness-index/history', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT entry_date, avg_mood, entry_count
       FROM v_barangay_mood_daily
      WHERE barangay_id = $1 AND entry_date >= CURRENT_DATE - 90
      ORDER BY entry_date`,
    [req.user.barangay_id]
  );
  res.json({ history: rows });
}));

// Module: Resource & Budget Management — 5/6/7.
router.get('/budget', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_barangay_budget WHERE barangay_id = $1',
    [req.user.barangay_id]);
  const subs = await query(
    `SELECT plan, status, amount, start_date, end_date FROM subscription
      WHERE barangay_id = $1 ORDER BY start_date DESC`,
    [req.user.barangay_id]);
  res.json({ budget: rows[0] ?? null, subscriptions: subs.rows });
}));

// Module: AI Effectiveness Tracker.
router.get('/ai-effectiveness', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM v_ai_effectiveness');
  res.json({ metrics: rows[0] });
}));


// ---------------------------------------------------------------------
// Module: Psychologist Directory (Joan Aballe, LGU)
//   1. View Psychologists  2. Search Directory  3. View Profiles
//
// An LGU is paying for sessions, so it may reasonably ask who is
// providing them and how much they are being used. It may not ask who
// saw whom: every figure here is a count, never a resident.
// ---------------------------------------------------------------------

router.get(
  '/psychologists',
  asyncHandler(async (req, res) => {
    const { q, language, specialization } = req.query;

    const { rows } = await query(
      `SELECT p.psychologist_id, p.specialization, p.languages, p.bio,
              p.rate_per_hour, p.verified_at,
              u.name, u.created_at AS joined_at,
              -- Sessions delivered to this barangay's residents only.
              COUNT(bk.booking_id) FILTER (
                WHERE bk.status = 'completed' AND r.barangay_id = $1)::int AS sessions_here,
              COUNT(bk.booking_id) FILTER (
                WHERE bk.status = 'completed')::int                        AS sessions_total,
              COUNT(DISTINCT bk.resident_id) FILTER (
                WHERE bk.status = 'completed' AND r.barangay_id = $1)::int AS residents_seen,
              -- Whether they currently work at all, which decides if
              -- recommending them to a resident is useful.
              EXISTS (SELECT 1 FROM availability a
                       WHERE a.psychologist_id = p.psychologist_id AND a.is_active) AS takes_bookings
         FROM psychologist p
         JOIN "user" u          ON u.user_id = p.user_id
         LEFT JOIN booking bk   ON bk.psychologist_id = p.psychologist_id
         LEFT JOIN "user" r     ON r.user_id = bk.resident_id
        WHERE p.is_verified = true
          AND u.status = 'active'
          AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR p.languages ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR p.specialization ILIKE '%' || $4 || '%')
        GROUP BY p.psychologist_id, p.specialization, p.languages, p.bio,
                 p.rate_per_hour, p.verified_at, u.name, u.created_at
        ORDER BY sessions_here DESC, u.name`,
      [req.user.barangay_id, q?.trim() || null, language || null, specialization || null]
    );

    // Filter options, drawn from what is actually there.
    const languages = [...new Set(
      rows.flatMap((r) => (r.languages || '').split(',').map((l) => l.trim()))
    )].filter(Boolean).sort();
    const specializations = [...new Set(
      rows.map((r) => r.specialization).filter(Boolean)
    )].sort();

    res.json({ psychologists: rows, languages, specializations });
  })
);

/** 3. View Profiles — one psychologist, with their working hours. */
router.get(
  '/psychologists/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT p.psychologist_id, p.specialization, p.languages, p.bio,
              p.rate_per_hour, p.license_no, p.verified_at,
              u.name, u.created_at AS joined_at,
              verifier.name AS verified_by_name
         FROM psychologist p
         JOIN "user" u ON u.user_id = p.user_id
         LEFT JOIN "user" verifier ON verifier.user_id = p.verified_by
        WHERE p.psychologist_id = $1 AND p.is_verified = true AND u.status = 'active'`,
      [req.params.id]
    );
    const p = rows[0];
    if (!p) throw ApiError.notFound('No such psychologist.');

    const { rows: availability } = await query(
      `SELECT day_of_week, start_time, end_time
         FROM availability
        WHERE psychologist_id = $1 AND is_active
        ORDER BY day_of_week, start_time`,
      [req.params.id]
    );

    const { rows: usage } = await query(
      `SELECT COUNT(*) FILTER (WHERE bk.status = 'completed')::int          AS completed,
              COUNT(*) FILTER (WHERE bk.status = 'no_show')::int            AS missed,
              COUNT(DISTINCT bk.resident_id)::int                          AS residents_seen,
              COALESCE(SUM(pay.amount) FILTER (WHERE bk.status = 'completed'), 0) AS spent_here
         FROM booking bk
         JOIN "user" r        ON r.user_id = bk.resident_id
         LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
        WHERE bk.psychologist_id = $1 AND r.barangay_id = $2`,
      [req.params.id, req.user.barangay_id]
    );

    res.json({
      psychologist: p,
      availability,
      // Scoped to this barangay: an LGU sees what it paid for.
      usage_in_barangay: usage[0],
    });
  })
);


// ---------------------------------------------------------------------
// Module: Barangay Risk Alerts (Marinelle Cebe)
//   1. View Risk Alerts  2. Manage Barangay Residents
//   3. Flag High-Risk Cases
//
// Table 8 gives an LGU these three, and the Scope chapter says an LGU sees
// aggregate data only. Both can hold, but only if the direction of
// information is right:
//
//   - Alerts are returned with barangay, risk level and date. Never who.
//   - Residents are listed by name, because a barangay already knows its
//     own constituents and has to name someone to give them a Care Credit.
//     No mental health data appears against any of them.
//   - Flagging is the barangay telling the system about someone they are
//     worried about, from their own knowledge of the community. It is not
//     the system telling the barangay who is at risk. A referral goes to
//     psychologists, and the barangay never learns whether that resident
//     was already flagged.
//
// That last inversion is the whole point. A barangay worker who visits
// houses knows things the app cannot see, and the app knows things the
// barangay must not see.
// ---------------------------------------------------------------------

/** 1. View Risk Alerts — anonymised, with filters. */
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const level = req.query.level || null;
    const days = Math.min(Number(req.query.days) || 30, 365);
    const citywide = req.user.role === 'admin' && req.query.scope === 'city';

    const { rows } = await query(
      `SELECT b.name AS barangay_name,
              c.risk_level,
              c.source,
              c.status,
              c.created_at,
              c.resolved_at,
              c.booking_id IS NOT NULL AS led_to_session,
              -- Days open, so a stale alert is visible without naming anyone.
              CASE WHEN c.status = 'resolved' THEN NULL
                   ELSE EXTRACT(DAY FROM now() - c.created_at)::int
              END AS days_open
         FROM crisis_alert c
         JOIN "user" u   ON u.user_id = c.user_id
         JOIN barangay b ON b.barangay_id = u.barangay_id
        WHERE ($1::boolean IS TRUE OR u.barangay_id = $2)
          AND c.created_at >= now() - ($3::int || ' days')::interval
          AND ($4::text IS NULL OR c.risk_level = $4)
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [citywide, req.user.barangay_id, days, level]
    );

    const { rows: summary } = await query(
      `SELECT c.risk_level,
              COUNT(*)::int                                      AS total,
              COUNT(*) FILTER (WHERE c.status = 'open')::int      AS still_open,
              COUNT(*) FILTER (WHERE c.booking_id IS NOT NULL)::int AS led_to_session,
              ROUND(AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 3600)
                    FILTER (WHERE c.resolved_at IS NOT NULL), 1) AS avg_hours_to_resolve
         FROM crisis_alert c
         JOIN "user" u ON u.user_id = c.user_id
        WHERE ($1::boolean IS TRUE OR u.barangay_id = $2)
          AND c.created_at >= now() - ($3::int || ' days')::interval
        GROUP BY c.risk_level`,
      [citywide, req.user.barangay_id, days]
    );

    res.json({
      alerts: rows,
      summary,
      note: 'Alerts show barangay, risk level and date only. Who raised them is never returned.',
    });
  })
);

/**
 * 2. Manage Barangay Residents.
 *
 * Registration and Care Credit position only. A barangay needs to know who
 * is signed up so it can allocate credits and follow up on outreach; it
 * does not get mood, journal, assessment or alert data against a name.
 */
router.get(
  '/residents',
  asyncHandler(async (req, res) => {
    const q = req.query.q?.trim() || null;

    const { rows } = await query(
      `SELECT u.user_id, u.name, u.status, u.created_at,
              COUNT(cc.credit_id) FILTER (WHERE cc.status = 'available')::int AS credits_available,
              COUNT(cc.credit_id) FILTER (WHERE cc.status = 'consumed')::int  AS credits_used,
              -- Whether they have used the service at all. A count, not content.
              EXISTS (SELECT 1 FROM booking bk
                       WHERE bk.resident_id = u.user_id
                         AND bk.status = 'completed')                         AS has_attended,
              -- Whether a barangay referral is already open for them, so the
              -- same person is not referred twice.
              EXISTS (SELECT 1 FROM crisis_alert c
                       WHERE c.user_id = u.user_id
                         AND c.source = 'lgu_referral'
                         AND c.status <> 'resolved')                          AS referral_open,
              ac.consented AS counted_in_statistics
         FROM "user" u
         LEFT JOIN care_credit cc         ON cc.resident_id = u.user_id
         LEFT JOIN v_analytics_consent ac ON ac.user_id = u.user_id
        WHERE u.barangay_id = $1 AND u.role = 'resident'
          AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%')
        GROUP BY u.user_id, u.name, u.status, u.created_at, ac.consented
        ORDER BY u.name`,
      [req.user.barangay_id, q]
    );

    res.json({
      residents: rows,
      note: 'Registration and Care Credit position only. No mood, journal, assessment or alert data is shown against a resident.',
    });
  })
);

/**
 * 3. Flag High-Risk Cases.
 *
 * A referral, raised from the barangay's own knowledge. It reaches
 * psychologists; it tells the barangay nothing back. The response
 * deliberately does not say whether this resident already had an open
 * alert, because that answer would leak exactly what the barangay must
 * not know.
 */
router.post(
  '/residents/:id/refer',
  asyncHandler(async (req, res) => {
    const { concern, urgency } = z
      .object({
        concern: z.string().trim().min(10, 'Describe what you have noticed.').max(500),
        urgency: z.enum(['moderate', 'high']).default('moderate'),
      })
      .parse(req.body);

    const { rows: r } = await query(
      `SELECT user_id, name FROM "user"
        WHERE user_id = $1 AND barangay_id = $2 AND role = 'resident'`,
      [req.params.id, req.user.barangay_id]
    );
    if (!r.length)
      throw ApiError.notFound('That resident is not registered in your barangay.');

    const existing = await query(
      `SELECT alert_id FROM crisis_alert
        WHERE user_id = $1 AND source = 'lgu_referral' AND status <> 'resolved'`,
      [r[0].user_id]
    );
    if (existing.rowCount)
      throw ApiError.conflict(
        'A referral for this resident is already open. Adding another would not reach anyone new.'
      );

    const { rows: alert } = await query(
      `INSERT INTO crisis_alert (user_id, source, risk_level, status)
       VALUES ($1, 'lgu_referral', $2, 'open')
       RETURNING alert_id`,
      [r[0].user_id, urgency === 'high' ? 'high' : 'moderate']
    );

    const { rows: onDuty } = await query(
      `SELECT p.user_id FROM psychologist p
         JOIN "user" u ON u.user_id = p.user_id
        WHERE p.is_verified = true AND u.status = 'active'`
    );
    await Promise.all(
      onDuty.map((p) =>
        notify(null, p.user_id,
          `A barangay referred a resident for support: ${concern}`,
          'system', '/psychologist/clients')
      )
    );

    // The resident is told, because being referred without knowing would
    // be worse than not being referred.
    await notify(null, r[0].user_id,
      'Your barangay let OpenUp know they would like to make sure you have support. A psychologist may reach out.',
      'system', '/app/book');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'lgu.refer', 'user', $2, $3)`,
      [req.user.user_id, r[0].user_id, { urgency, psychologists_notified: onDuty.length }]
    );

    res.status(201).json({
      ok: true,
      psychologists_notified: onDuty.length,
      note: 'The resident has been told a referral was made. Whether they were already flagged by the system is not shown here, by design.',
    });
  })
);

// ---------------------------------------------------------------------
// Module: Mental Health Heatmap — 3. Filter by Distress Level
// Module: Community Wellness Index — 2. Compare by Period
//
// The view only covers the last 30 days, so a period comparison needs the
// index computed over arbitrary dates. Same weighting as
// v_community_wellness_index, kept in one shape so the two agree.
// ---------------------------------------------------------------------

const INDEX_SQL = `
  WITH residents AS (
    SELECT u.barangay_id, COUNT(*) AS resident_count
      FROM "user" u
      JOIN v_analytics_consent ac ON ac.user_id = u.user_id AND ac.consented
     WHERE u.role = 'resident' AND u.status = 'active'
     GROUP BY u.barangay_id
  ),
  mood AS (
    SELECT u.barangay_id,
           AVG(m.mood_level)         AS avg_mood,
           COUNT(DISTINCT m.user_id) AS active_users,
           COUNT(*)                  AS entries
      FROM mood_entry m
      JOIN "user" u                ON u.user_id = m.user_id
      JOIN v_analytics_consent ac  ON ac.user_id = u.user_id AND ac.consented
     WHERE m.entry_date >= $1::date AND m.entry_date <= $2::date
     GROUP BY u.barangay_id
  ),
  crisis AS (
    SELECT u.barangay_id, COUNT(*) AS crisis_count
      FROM crisis_alert c
      JOIN "user" u                ON u.user_id = c.user_id
      JOIN v_analytics_consent ac  ON ac.user_id = u.user_id AND ac.consented
     WHERE c.created_at >= $1::date AND c.created_at < $2::date + 1
     GROUP BY u.barangay_id
  )
  SELECT b.barangay_id,
         b.name AS barangay_name,
         COALESCE(r.resident_count, 0)::int    AS resident_count,
         COALESCE(m.entries, 0)::int           AS mood_entries,
         ROUND(COALESCE(m.avg_mood, 0), 2)     AS avg_mood,
         COALESCE(c.crisis_count, 0)::int      AS crisis_count,
         GREATEST(0, LEAST(100, ROUND(
                COALESCE(m.avg_mood, 3) / 5 * 60
              + LEAST(1.0, COALESCE(m.active_users, 0)::NUMERIC
                           / COALESCE(NULLIF(r.resident_count, 0), 1)) * 25
              + (1 - LEAST(1.0, COALESCE(c.crisis_count, 0)::NUMERIC
                           / COALESCE(NULLIF(r.resident_count, 0), 1) * 10)) * 15
         )))::int                              AS wellness_index,
         -- No data is not the same as wellbeing. Saying so stops a barangay
         -- reading an empty month as a good month.
         (COALESCE(m.entries, 0) = 0)          AS no_data
    FROM barangay b
    LEFT JOIN residents r ON r.barangay_id = b.barangay_id
    LEFT JOIN mood      m ON m.barangay_id = b.barangay_id
    LEFT JOIN crisis    c ON c.barangay_id = b.barangay_id
   ORDER BY wellness_index, b.name
`;

/** Distress bands, so the filter means the same thing everywhere. */
const BANDS = {
  severe:   { max: 39, label: 'Severe concern' },
  high:     { min: 40, max: 54, label: 'High concern' },
  moderate: { min: 55, max: 69, label: 'Moderate concern' },
  low:      { min: 70, label: 'Low concern' },
};

router.get(
  '/heatmap',
  asyncHandler(async (req, res) => {
    // Default to the last 30 days, matching the dashboard.
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const from = req.query.from
      || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    if (from > to) throw ApiError.badRequest('The start date is after the end date.');

    // The same span immediately before, for the comparison.
    const span = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86_400_000));
    const prevTo = new Date(new Date(from).getTime() - 86_400_000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(prevTo).getTime() - span * 86_400_000)
      .toISOString().slice(0, 10);

    const [current, previous] = await Promise.all([
      query(INDEX_SQL, [from, to]),
      query(INDEX_SQL, [prevFrom, prevTo]),
    ]);

    const prev = Object.fromEntries(
      previous.rows.map((r) => [r.barangay_id, r.wellness_index])
    );

    const band = (index) =>
      index < 40 ? 'severe' : index < 55 ? 'high' : index < 70 ? 'moderate' : 'low';

    let barangays = current.rows.map((r) => ({
      ...r,
      band: band(r.wellness_index),
      previous_index: prev[r.barangay_id] ?? null,
      change: prev[r.barangay_id] != null
        ? r.wellness_index - prev[r.barangay_id]
        : null,
    }));

    // 3. Filter by Distress Level.
    if (req.query.level && BANDS[req.query.level])
      barangays = barangays.filter((b) => b.band === req.query.level);

    res.json({
      period: { from, to },
      compared_with: { from: prevFrom, to: prevTo },
      bands: Object.entries(BANDS).map(([key, v]) => ({ key, ...v })),
      barangays,
      // An LGU sees its own barangay highlighted; an admin sees all equally.
      own_barangay_id: req.user.role === 'admin' ? null : req.user.barangay_id,
    });
  })
);

export default router;
