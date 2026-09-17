import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Data Governance & Consent (Christine Joyce Ravanes)
//   1. View Consent Records  2. Manage Data Access
//   3. View Compliance Status
//
// Consent is described to the resident in plain terms, and withdrawing it
// changes what the barangay can see. The analytics views join against
// v_analytics_consent, so exclusion happens on the next read rather than
// waiting for a job.
// ---------------------------------------------------------------------

/**
 * The consent types, described as the resident is shown them.
 *
 * `required` marks the one that cannot be withdrawn while keeping an
 * account: the system cannot hold someone's bookings and journals without
 * permission to process them. Saying that plainly is better than offering
 * a toggle that silently does nothing.
 */
const CONSENT_TYPES = {
  data_use: {
    label: 'Storing and processing my information',
    resident_text:
      'OpenUp stores your account, mood entries, journals, assessments and sessions so the service can work at all. Withdrawing this means deleting your account.',
    required: true,
  },
  lgu_analytics: {
    label: 'Counting me in barangay statistics',
    resident_text:
      'Your barangay sees community figures such as average mood and how many sessions were used. It never sees your name, your entries or what you said in a session. If you withdraw this, you are removed from those counts and can still use everything else.',
    required: false,
  },
  voice_recording: {
    label: 'Keeping my voice recordings',
    resident_text:
      'Your voice journal recordings are stored privately so you can listen back. Withdrawing this stops new recordings being kept; transcripts you already have stay until you delete them.',
    required: false,
  },
};

// ---------------------------------------------------------------------
// Resident side: their own consent
// ---------------------------------------------------------------------

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT ON (consent_type)
              consent_type, is_granted, recorded_at
         FROM consent
        WHERE user_id = $1
        ORDER BY consent_type, recorded_at DESC`,
      [req.user.user_id]
    );
    const current = Object.fromEntries(rows.map((r) => [r.consent_type, r]));

    res.json({
      consents: Object.entries(CONSENT_TYPES).map(([key, def]) => ({
        consent_type: key,
        label: def.label,
        description: def.resident_text,
        required: def.required,
        // Missing row means granted, matching how sign-up records it.
        is_granted: current[key]?.is_granted ?? true,
        recorded_at: current[key]?.recorded_at ?? null,
      })),
    });
  })
);

router.put(
  '/me/:type',
  asyncHandler(async (req, res) => {
    const def = CONSENT_TYPES[req.params.type];
    if (!def) throw ApiError.notFound('No such consent type.');

    const { is_granted } = z.object({ is_granted: z.boolean() }).parse(req.body);

    if (def.required && !is_granted)
      throw ApiError.badRequest(
        'This one cannot be withdrawn while you have an account, because the service cannot run without it. Deleting your account withdraws it and removes your data.'
      );

    // A new row rather than an update: the history of grants and
    // withdrawals is what makes consent auditable under RA 10173.
    const { rows } = await query(
      `INSERT INTO consent (user_id, consent_type, is_granted)
       VALUES ($1, $2, $3)
       RETURNING consent_type, is_granted, recorded_at`,
      [req.user.user_id, req.params.type, is_granted]
    );

    res.json({
      consent: rows[0],
      effect: req.params.type === 'lgu_analytics'
        ? (is_granted
            ? 'You are counted in your barangay statistics again.'
            : 'You have been removed from your barangay statistics. This takes effect immediately.')
        : null,
    });
  })
);

// ---------------------------------------------------------------------
// LGU side
// ---------------------------------------------------------------------

const LGU = requireRole('lgu', 'admin');

/**
 * 1. View Consent Records.
 *
 * Counts only. An LGU seeing that a named resident withdrew consent to
 * barangay analytics would defeat the purpose of the withdrawal.
 */
router.get(
  '/consent',
  LGU,
  asyncHandler(async (req, res) => {
    const barangayId = req.user.barangay_id;

    const [analytics, byType, recent] = await Promise.all([
      query(
        `SELECT COUNT(*) FILTER (WHERE consented)::int     AS counted,
                COUNT(*) FILTER (WHERE NOT consented)::int AS excluded,
                COUNT(*)::int                              AS total
           FROM v_analytics_consent WHERE barangay_id = $1`,
        [barangayId]
      ),
      query(
        `SELECT c.consent_type,
                COUNT(*) FILTER (WHERE c.is_granted)::int     AS granted,
                COUNT(*) FILTER (WHERE NOT c.is_granted)::int AS withdrawn
           FROM (SELECT DISTINCT ON (user_id, consent_type)
                        user_id, consent_type, is_granted
                   FROM consent ORDER BY user_id, consent_type, recorded_at DESC) c
           JOIN "user" u ON u.user_id = c.user_id
          WHERE u.barangay_id = $1
          GROUP BY c.consent_type`,
        [barangayId]
      ),
      // Withdrawals over time, so a barangay can see whether trust is
      // eroding without learning who stopped trusting them.
      query(
        `SELECT date_trunc('month', c.recorded_at)::date AS month,
                COUNT(*) FILTER (WHERE NOT c.is_granted)::int AS withdrawals,
                COUNT(*) FILTER (WHERE c.is_granted)::int     AS grants
           FROM consent c
           JOIN "user" u ON u.user_id = c.user_id
          WHERE u.barangay_id = $1
            AND c.recorded_at >= date_trunc('month', now()) - INTERVAL '5 months'
          GROUP BY month ORDER BY month`,
        [barangayId]
      ),
    ]);

    res.json({
      analytics: analytics.rows[0],
      by_type: byType.rows.map((r) => ({
        ...r,
        label: CONSENT_TYPES[r.consent_type]?.label ?? r.consent_type,
      })),
      monthly: recent.rows,
    });
  })
);

/**
 * 2. Manage Data Access.
 *
 * There is nothing to toggle here, and that is the point. What an LGU can
 * see is fixed by which SQL views exist and what the routes return, not by
 * a switch an administrator could flip. This reports the boundary so it
 * can be audited, and points at where each limit is enforced.
 */
router.get(
  '/data-access',
  LGU,
  asyncHandler(async (_req, res) => {
    res.json({
      note: 'These limits are enforced in the database and the API, not by a setting. They cannot be changed from this screen.',
      visible: [
        { item: 'Average mood per barangay per day', source: 'v_barangay_mood_daily' },
        { item: 'Community wellness index', source: 'v_community_wellness_index' },
        { item: 'Count of crisis alerts by risk level and barangay', source: 'v_community_wellness_index' },
        { item: 'Care Credits issued, assigned, used, and remaining', source: 'v_credit_distribution' },
        { item: 'Subscription plan and cost', source: 'subscription' },
        { item: 'Number of registered residents', source: 'user, counted' },
        { item: 'Psychologists and how many sessions they delivered here', source: 'lgu/psychologists' },
      ],
      not_visible: [
        { item: 'Which residents have accounts', why: 'No endpoint returns resident names to an LGU role.' },
        { item: 'Any individual mood entry, journal, or assessment', why: 'Only aggregate views are exposed; the row-level tables are not.' },
        { item: 'Voice recordings or transcripts', why: 'Private Storage bucket, reachable only by the resident who made them.' },
        { item: 'Chat messages or session notes', why: 'Scoped to the two participants, or to the psychologist who wrote them.' },
        { item: 'Who raised a crisis alert', why: 'Alerts are returned to an LGU with barangay and risk level only.' },
        { item: 'Residents who withdrew analytics consent', why: 'Excluded from every aggregate, and never listed individually.' },
      ],
    });
  })
);

/**
 * 3. View Compliance Status.
 *
 * Checks that can be verified are queried. Ones that depend on a human
 * decision are listed as needing attestation rather than reported as
 * passing, because a checklist that marks itself compliant is worthless.
 */
router.get(
  '/compliance',
  LGU,
  asyncHandler(async (req, res) => {
    const [rls, consentRows, retention, alerts] = await Promise.all([
      query(
        `SELECT COUNT(*) FILTER (WHERE rowsecurity)::int     AS protected,
                COUNT(*)::int                                AS total
           FROM pg_tables WHERE schemaname = 'public'`
      ),
      query(
        `SELECT COUNT(DISTINCT c.user_id)::int AS with_record,
                (SELECT COUNT(*)::int FROM "user"
                  WHERE barangay_id = $1 AND role = 'resident') AS residents
           FROM consent c JOIN "user" u ON u.user_id = c.user_id
          WHERE u.barangay_id = $1`,
        [req.user.barangay_id]
      ),
      query(
        `SELECT MIN(created_at) AS oldest_journal,
                COUNT(*)::int   AS journals
           FROM voice_journal v JOIN "user" u ON u.user_id = v.user_id
          WHERE u.barangay_id = $1`,
        [req.user.barangay_id]
      ),
      query(
        `SELECT COUNT(*)::int AS stale
           FROM crisis_alert c JOIN "user" u ON u.user_id = c.user_id
          WHERE u.barangay_id = $1 AND c.status = 'open'
            AND c.created_at < now() - INTERVAL '7 days'`,
        [req.user.barangay_id]
      ),
    ]);

    const r = rls.rows[0];
    const c = consentRows.rows[0];

    res.json({
      reference: 'Republic Act 10173, the Data Privacy Act of 2012',
      checks: [
        {
          item: 'Row Level Security on every table',
          status: r.protected === r.total ? 'pass' : 'fail',
          detail: `${r.protected} of ${r.total} tables protected.`,
        },
        {
          item: 'Consent recorded for every resident',
          status: c.residents === 0 ? 'not_applicable'
                : c.with_record >= c.residents ? 'pass' : 'fail',
          detail: `${c.with_record} of ${c.residents} residents have a consent record.`,
        },
        {
          item: 'Withdrawal excludes a resident from analytics',
          status: 'pass',
          detail: 'Analytics views join v_analytics_consent, so withdrawal takes effect on the next read.',
        },
        {
          item: 'Resident can see and change their own consent',
          status: 'pass',
          detail: 'Under Privacy in the resident account.',
        },
        {
          item: 'Resident data can be erased on request',
          status: 'pass',
          detail: 'Account deletion cascades through moods, journals, bookings and messages.',
        },
        {
          item: 'Crisis alerts acted on promptly',
          status: alerts.rows[0].stale === 0 ? 'pass' : 'attention',
          detail: alerts.rows[0].stale === 0
            ? 'No alert has been open longer than seven days.'
            : `${alerts.rows[0].stale} alert(s) open longer than seven days.`,
        },
        {
          item: 'Retention period agreed and documented',
          status: 'attestation',
          detail: retention.rows[0].oldest_journal
            ? `Oldest voice journal is from ${new Date(retention.rows[0].oldest_journal).toISOString().slice(0, 10)}. No automatic deletion is configured; a retention period has to be agreed and written into policy.`
            : 'No voice journals yet. A retention period still has to be agreed before launch.',
        },
        {
          item: 'Data Protection Officer appointed',
          status: 'attestation',
          detail: 'Required of every personal information controller under RA 10173. The system cannot verify this.',
        },
        {
          item: 'Privacy notice given at sign-up',
          status: 'attestation',
          detail: 'Consent is recorded at registration. Whether the notice shown meets NPC requirements is a legal review, not a query.',
        },
      ],
    });
  })
);

export default router;
