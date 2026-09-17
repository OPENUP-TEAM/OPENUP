import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendCsv, resolvePeriod } from '../services/export.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: AI Effectiveness Tracker
//   1. View Detection Accuracy  2. View Escalation Outcomes
//   3. View User Ratings
//
// Module: Reports & Analytics (Marinelle Cebe, admin)
//   1. View Platform Reports  2. Generate Analytics  3. Export Data
// ---------------------------------------------------------------------

const period = (req) => {
  try {
    return resolvePeriod(req.query, 90);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
};

/**
 * 1. View Detection Accuracy.
 *
 * Accuracy is computed only over alerts a psychologist has actually
 * resolved and judged. Anything else would be a made-up number: the
 * system cannot know whether a detection was right unless a human who
 * spoke to the person says so.
 *
 * What cannot be measured is said plainly rather than estimated. There is
 * no count of missed cases, because a resident in danger who was never
 * detected leaves no record. Recall is therefore unknown, and reporting a
 * figure that ignores that would be worse than reporting nothing.
 */
router.get(
  '/ai-effectiveness',
  requireRole('lgu', 'admin'),
  asyncHandler(async (req, res) => {
    const p = period(req);

    const [detection, bySource, outcomes, ratings, response] = await Promise.all([
      query(
        `SELECT COUNT(*)::int                                          AS raised,
                COUNT(*) FILTER (WHERE status = 'resolved')::int        AS reviewed,
                COUNT(*) FILTER (WHERE was_helpful IS TRUE)::int        AS confirmed_real,
                COUNT(*) FILTER (WHERE was_helpful IS FALSE)::int       AS false_positive,
                COUNT(*) FILTER (WHERE status <> 'resolved')::int       AS still_open
           FROM crisis_alert
          WHERE created_at >= $1::date AND created_at < $2::date + 1`,
        [p.from, p.to]
      ),
      query(
        `SELECT source,
                COUNT(*)::int                                    AS raised,
                COUNT(*) FILTER (WHERE was_helpful IS TRUE)::int  AS confirmed_real,
                COUNT(*) FILTER (WHERE was_helpful IS FALSE)::int AS false_positive
           FROM crisis_alert
          WHERE created_at >= $1::date AND created_at < $2::date + 1
          GROUP BY source
          ORDER BY raised DESC`,
        [p.from, p.to]
      ),
      // 2. View Escalation Outcomes, from the audit trail the resolve
      // endpoint writes.
      query(
        `SELECT a.meta->>'outcome'                               AS outcome,
                COUNT(*)::int                                    AS n,
                ROUND(AVG((a.meta->>'hours_to_resolve')::numeric), 1) AS avg_hours
           FROM audit_log a
          WHERE a.action = 'alert.resolve'
            AND a.created_at >= $1::date AND a.created_at < $2::date + 1
            AND a.meta->>'outcome' IS NOT NULL
          GROUP BY outcome
          ORDER BY n DESC`,
        [p.from, p.to]
      ),
      // 3. View User Ratings.
      query(
        `SELECT COUNT(*) FILTER (WHERE helpfulness_rating IS NOT NULL)::int AS rated,
                COUNT(*)::int                                               AS conversations,
                ROUND(AVG(helpfulness_rating), 2)                           AS avg_rating,
                COUNT(*) FILTER (WHERE helpfulness_rating >= 4)::int        AS helpful,
                COUNT(*) FILTER (WHERE helpfulness_rating <= 2)::int        AS unhelpful
           FROM ai_conversation
          WHERE started_at >= $1::date AND started_at < $2::date + 1`,
        [p.from, p.to]
      ),
      query(
        `SELECT ROUND(AVG(response_ms))::int AS avg_ms,
                COUNT(*)::int                AS replies
           FROM ai_message
          WHERE role = 'assistant'
            AND response_ms IS NOT NULL
            AND sent_at >= $1::date AND sent_at < $2::date + 1`,
        [p.from, p.to]
      ),
    ]);

    const d = detection.rows[0];

    // Precision over reviewed alerts only, and null when the sample is too
    // small to mean anything. A percentage from three alerts is noise
    // dressed as a metric.
    const precision =
      d.reviewed >= 10
        ? Math.round((d.confirmed_real / (d.confirmed_real + d.false_positive || 1)) * 100)
        : null;

    res.json({
      period: p,
      detection: {
        ...d,
        precision,
        review_rate: d.raised ? Math.round((d.reviewed / d.raised) * 100) : 0,
      },
      by_source: bySource.rows.map((r) => ({
        ...r,
        precision: r.confirmed_real + r.false_positive >= 5
          ? Math.round((r.confirmed_real / (r.confirmed_real + r.false_positive)) * 100)
          : null,
      })),
      outcomes: outcomes.rows,
      ratings: ratings.rows[0],
      response: response.rows[0],
      limits: [
        'Accuracy is measured only over alerts a psychologist reviewed and judged. Unreviewed alerts are excluded rather than assumed correct.',
        'There is no measure of missed cases. A resident in danger who was never detected leaves no record, so recall cannot be calculated from this data.',
        'Precision is withheld below ten reviewed alerts, because a percentage over a handful of cases is noise.',
        'Ratings come from residents who chose to answer, which skews toward people still engaged enough to reply.',
      ],
    });
  })
);

// ---------------------------------------------------------------------
// Reports & Analytics (admin)
// ---------------------------------------------------------------------

const ADMIN = requireRole('admin');

/** 1. View Platform Reports. */
router.get(
  '/platform',
  ADMIN,
  asyncHandler(async (req, res) => {
    const p = period(req);

    const [growth, activity, service, money] = await Promise.all([
      query(
        `SELECT date_trunc('month', created_at)::date AS month,
                COUNT(*) FILTER (WHERE role = 'resident')::int     AS residents,
                COUNT(*) FILTER (WHERE role = 'psychologist')::int AS psychologists,
                COUNT(*) FILTER (WHERE role = 'lgu')::int          AS lgu_accounts
           FROM "user"
          WHERE created_at >= $1::date AND created_at < $2::date + 1
          GROUP BY month ORDER BY month`,
        [p.from, p.to]
      ),
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM mood_entry
             WHERE entry_date BETWEEN $1::date AND $2::date)                  AS mood_entries,
           (SELECT COUNT(*)::int FROM voice_journal
             WHERE created_at >= $1::date AND created_at < $2::date + 1)      AS journals,
           (SELECT COUNT(*)::int FROM assessment
             WHERE taken_at >= $1::date AND taken_at < $2::date + 1)          AS assessments,
           (SELECT COUNT(*)::int FROM ai_conversation
             WHERE started_at >= $1::date AND started_at < $2::date + 1)      AS ai_chats,
           (SELECT COUNT(*)::int FROM message
             WHERE sent_at >= $1::date AND sent_at < $2::date + 1)            AS chat_messages,
           (SELECT COUNT(*)::int FROM testimonial
             WHERE created_at >= $1::date AND created_at < $2::date + 1)      AS posts`,
        [p.from, p.to]
      ),
      query(
        `SELECT COUNT(*)::int                                            AS bookings,
                COUNT(*) FILTER (WHERE status = 'completed')::int         AS completed,
                COUNT(*) FILTER (WHERE status = 'no_show')::int           AS missed,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int         AS cancelled,
                COUNT(*) FILTER (WHERE session_type = 'group')::int       AS group_sessions,
                COUNT(DISTINCT resident_id)::int                          AS residents_served,
                COUNT(DISTINCT psychologist_id)::int                      AS psychologists_active
           FROM booking
          WHERE schedule >= $1::date AND schedule < $2::date + 1`,
        [p.from, p.to]
      ),
      query(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM subscription
             WHERE status = 'active')                                        AS subscription_revenue,
           (SELECT COUNT(*)::int FROM subscription WHERE status = 'active')   AS active_subscriptions,
           (SELECT COUNT(*)::int FROM subscription WHERE status = 'pending')  AS awaiting_payment,
           (SELECT COALESCE(SUM(amount), 0) FROM care_credit
             WHERE issued_at >= $1::date AND issued_at < $2::date + 1)        AS credits_allocated,
           (SELECT COALESCE(SUM(cc.amount), 0) FROM care_credit cc
              JOIN booking bk ON bk.care_credit_id = cc.credit_id
             WHERE cc.status = 'consumed'
               AND bk.schedule >= $1::date AND bk.schedule < $2::date + 1)    AS credits_spent`,
        [p.from, p.to]
      ),
    ]);

    const s = service.rows[0];

    res.json({
      period: p,
      growth: growth.rows,
      activity: activity.rows[0],
      service: {
        ...s,
        // Only reported over a sample big enough to mean something.
        completion_rate: s.completed + s.missed >= 10
          ? Math.round((s.completed / (s.completed + s.missed)) * 100)
          : null,
      },
      money: money.rows[0],
    });
  })
);

/** 3. Export Data. */
router.get(
  '/platform/export',
  ADMIN,
  asyncHandler(async (req, res) => {
    const p = period(req);
    const dataset = req.query.dataset || 'sessions';

    const DATASETS = {
      sessions: {
        name: 'sessions',
        sql: `SELECT bk.booking_id, bk.schedule, bk.status, bk.session_type,
                     bk.duration_min,
                     b.name AS barangay,
                     ps.name AS psychologist,
                     bk.care_credit_id IS NOT NULL AS care_credit,
                     COALESCE(pay.amount, 0) AS amount
                FROM booking bk
                JOIN "user" r        ON r.user_id = bk.resident_id
                JOIN barangay b      ON b.barangay_id = r.barangay_id
                JOIN psychologist p  ON p.psychologist_id = bk.psychologist_id
                JOIN "user" ps       ON ps.user_id = p.user_id
                LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
               WHERE bk.schedule >= $1::date AND bk.schedule < $2::date + 1
               ORDER BY bk.schedule`,
        columns: [
          { key: 'booking_id',   label: 'Booking' },
          { key: 'schedule',     label: 'When' },
          { key: 'barangay',     label: 'Barangay' },
          { key: 'psychologist', label: 'Psychologist' },
          { key: 'session_type', label: 'Type' },
          { key: 'status',       label: 'Status' },
          { key: 'duration_min', label: 'Minutes' },
          { key: 'care_credit',  label: 'Care Credit' },
          { key: 'amount',       label: 'Amount' },
        ],
        // No resident column at all. An export is the easiest way for
        // clinical data to leave a system, so the identifier is not in it.
        note: 'Residents are not identified in this export.',
      },
      barangays: {
        name: 'barangay-summary',
        sql: `SELECT b.name AS barangay,
                     (SELECT COUNT(*)::int FROM "user" u
                       WHERE u.barangay_id = b.barangay_id AND u.role = 'resident') AS residents,
                     (SELECT s.plan FROM subscription s
                       WHERE s.barangay_id = b.barangay_id AND s.status = 'active'
                       LIMIT 1) AS plan,
                     d.pool_count, d.assigned_count, d.consumed_count, d.utilization_pct,
                     w.avg_mood, w.crisis_count, w.wellness_index
                FROM barangay b
                LEFT JOIN v_credit_distribution d     ON d.barangay_id = b.barangay_id
                LEFT JOIN v_community_wellness_index w ON w.barangay_id = b.barangay_id
               WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL
               ORDER BY b.name`,
        columns: [
          { key: 'barangay',        label: 'Barangay' },
          { key: 'residents',       label: 'Residents' },
          { key: 'plan',            label: 'Plan' },
          { key: 'pool_count',      label: 'Credits unassigned' },
          { key: 'assigned_count',  label: 'Credits assigned' },
          { key: 'consumed_count',  label: 'Credits used' },
          { key: 'utilization_pct', label: 'Utilization %' },
          { key: 'avg_mood',        label: 'Average mood' },
          { key: 'crisis_count',    label: 'Crisis alerts' },
          { key: 'wellness_index',  label: 'Wellness index' },
        ],
        note: 'Aggregate figures per barangay. Wellness index reflects the last 30 days.',
      },
      alerts: {
        name: 'crisis-alerts',
        sql: `SELECT c.alert_id, c.source, c.risk_level, c.status,
                     c.created_at, c.resolved_at, c.was_helpful,
                     b.name AS barangay,
                     c.booking_id IS NOT NULL AS led_to_session
                FROM crisis_alert c
                JOIN "user" u   ON u.user_id = c.user_id
                JOIN barangay b ON b.barangay_id = u.barangay_id
               WHERE c.created_at >= $1::date AND c.created_at < $2::date + 1
               ORDER BY c.created_at`,
        columns: [
          { key: 'alert_id',       label: 'Alert' },
          { key: 'barangay',       label: 'Barangay' },
          { key: 'source',         label: 'Source' },
          { key: 'risk_level',     label: 'Risk level' },
          { key: 'status',         label: 'Status' },
          { key: 'created_at',     label: 'Raised' },
          { key: 'resolved_at',    label: 'Resolved' },
          { key: 'was_helpful',    label: 'Confirmed real' },
          { key: 'led_to_session', label: 'Led to session' },
        ],
        note: 'Residents are not identified. Confirmed real is a psychologist judgement, blank where unreviewed.',
      },
    };

    const d = DATASETS[dataset];
    if (!d) throw ApiError.badRequest('Unknown dataset.');

    const { rows } = await query(d.sql, [p.from, p.to]);

    sendCsv(res, {
      rows,
      columns: d.columns,
      name: d.name,
      period: p,
      meta: {
        report: `Platform export: ${dataset}`,
        period: `${p.from} to ${p.to}`,
        generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        generated_by: req.user.name,
        rows: rows.length,
        note: d.note,
      },
    });
  })
);

/** Admin Dashboard: platform statistics, system health, pending tasks. */
router.get(
  '/dashboard',
  ADMIN,
  asyncHandler(async (_req, res) => {
    const [stats, health, pending] = await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM "user" WHERE role = 'resident' AND status = 'active')  AS residents,
           (SELECT COUNT(*)::int FROM psychologist WHERE is_verified)                        AS psychologists,
           (SELECT COUNT(*)::int FROM barangay)                                              AS barangays,
           (SELECT COUNT(*)::int FROM subscription WHERE status = 'active')                  AS subscriptions,
           (SELECT COUNT(*)::int FROM booking WHERE status = 'completed')                    AS sessions_completed,
           (SELECT COUNT(*)::int FROM booking
             WHERE status = 'confirmed' AND schedule > now())                                AS sessions_upcoming,
           (SELECT COUNT(*)::int FROM "user"
             WHERE created_at >= now() - INTERVAL '7 days')                                  AS joined_this_week,
           (SELECT COUNT(*)::int FROM booking
             WHERE created_at >= now() - INTERVAL '7 days')                                  AS booked_this_week`
      ),
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM voice_journal
             WHERE status = 'failed' AND created_at >= now() - INTERVAL '7 days')  AS journals_failed,
           (SELECT COUNT(*)::int FROM voice_journal
             WHERE status NOT IN ('ready','failed')
               AND created_at < now() - INTERVAL '1 hour')                         AS journals_stuck,
           (SELECT COUNT(*)::int FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
             WHERE u.status = 'active' AND p.is_verified
               AND NOT EXISTS (SELECT 1 FROM availability a
                                WHERE a.psychologist_id = p.psychologist_id
                                  AND a.is_active))                               AS psychologists_without_hours,
           (SELECT COUNT(*)::int FROM barangay b
             WHERE NOT EXISTS (SELECT 1 FROM subscription s
                                WHERE s.barangay_id = b.barangay_id
                                  AND s.status = 'active')
               AND EXISTS (SELECT 1 FROM "user" u
                            WHERE u.barangay_id = b.barangay_id
                              AND u.role = 'resident'))                           AS barangays_unfunded`
      ),
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM "user" u JOIN psychologist p ON p.user_id = u.user_id
             WHERE u.status = 'pending')                                     AS licenses_to_review,
           (SELECT COUNT(*)::int FROM content_flag WHERE status = 'pending')  AS content_to_moderate,
           (SELECT COUNT(*)::int FROM crisis_alert
             WHERE status <> 'resolved'
               AND created_at < now() - INTERVAL '7 days')                    AS stale_alerts,
           (SELECT COUNT(*)::int FROM subscription
             WHERE status = 'pending')                                        AS subscriptions_awaiting_payment,
           (SELECT COUNT(*)::int FROM subscription
             WHERE status = 'active' AND end_date IS NOT NULL
               AND end_date < CURRENT_DATE + 30)                              AS subscriptions_expiring`
      ),
    ]);

    res.json({
      stats: stats.rows[0],
      health: health.rows[0],
      pending: pending.rows[0],
    });
  })
);

export default router;
