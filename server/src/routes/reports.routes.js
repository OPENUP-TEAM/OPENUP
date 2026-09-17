import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendCsv, resolvePeriod } from '../services/export.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Psychologist Reports (Marinelle Cebe)
//   1. View Session Reports  2. View Earnings Report  3. Export Report
//
// Module: Accomplishment Report (Marinelle Cebe)
//   1. Generate Barangay Report  2. Generate All-Barangay Report
//   3. Export Report
//
// Every export goes through export.service.js. A report and its CSV are
// built from the same query, so the file can never disagree with what was
// on screen.
// ---------------------------------------------------------------------

const period = (req) => {
  try {
    return resolvePeriod(req.query, 90);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
};

// ---------------------------------------------------------------------
// Psychologist Reports
// ---------------------------------------------------------------------

async function psychologistId(userId) {
  const { rows } = await query(
    'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) throw ApiError.notFound('No psychologist profile on this account.');
  return rows[0].psychologist_id;
}

/** 1. View Session Reports. */
router.get(
  '/psychologist/sessions',
  requireRole('psychologist'),
  asyncHandler(async (req, res) => {
    const p = period(req);
    const id = await psychologistId(req.user.user_id);

    const { rows } = await query(
      `SELECT bk.booking_id,
              bk.schedule,
              bk.status,
              bk.session_type,
              bk.duration_min,
              COALESCE(u.display_alias, 'Resident ' || u.user_id) AS client,
              b.name AS barangay,
              bk.care_credit_id IS NOT NULL AS care_credit,
              COALESCE(pay.amount, 0)       AS amount,
              (SELECT COUNT(*)::int FROM session_note n
                WHERE n.booking_id = bk.booking_id) AS notes
         FROM booking bk
         JOIN "user" u    ON u.user_id = bk.resident_id
         JOIN barangay b  ON b.barangay_id = u.barangay_id
         LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
        WHERE bk.psychologist_id = $1
          AND bk.schedule >= $2::date
          AND bk.schedule < $3::date + 1
        ORDER BY bk.schedule DESC`,
      [id, p.from, p.to]
    );

    const summary = rows.reduce(
      (t, r) => ({
        total: t.total + 1,
        completed: t.completed + (r.status === 'completed' ? 1 : 0),
        cancelled: t.cancelled + (['cancelled', 'declined'].includes(r.status) ? 1 : 0),
        missed: t.missed + (r.status === 'no_show' ? 1 : 0),
        hours: t.hours + (r.status === 'completed' ? r.duration_min / 60 : 0),
      }),
      { total: 0, completed: 0, cancelled: 0, missed: 0, hours: 0 }
    );

    // Attendance is the number a psychologist is actually judged on, and a
    // rate over a tiny denominator is noise, so it is only reported when
    // there is something to report.
    summary.attendance_rate =
      summary.completed + summary.missed >= 5
        ? Math.round((summary.completed / (summary.completed + summary.missed)) * 100)
        : null;

    if (req.query.format === 'csv') {
      return sendCsv(res, {
        rows,
        name: 'session-report',
        period: p,
        meta: {
          report: 'Session report',
          psychologist: req.user.name,
          period: `${p.from} to ${p.to}`,
          generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
          sessions_completed: summary.completed,
          hours_delivered: summary.hours.toFixed(1),
        },
        columns: [
          { key: 'schedule',      label: 'Date and time' },
          { key: 'client',        label: 'Client' },
          { key: 'barangay',      label: 'Barangay' },
          { key: 'session_type',  label: 'Type' },
          { key: 'status',        label: 'Status' },
          { key: 'duration_min',  label: 'Minutes' },
          { key: 'care_credit',   label: 'Care Credit' },
          { key: 'amount',        label: 'Amount' },
          { key: 'notes',         label: 'Notes written' },
        ],
      });
    }

    res.json({ period: p, summary, sessions: rows });
  })
);

/** 2. View Earnings Report. */
router.get(
  '/psychologist/earnings',
  requireRole('psychologist'),
  asyncHandler(async (req, res) => {
    const p = period(req);
    const id = await psychologistId(req.user.user_id);

    const { rows } = await query(
      `SELECT date_trunc('month', bk.schedule)::date AS month,
              COUNT(*)::int                          AS sessions,
              SUM(bk.duration_min)::int              AS minutes,
              COALESCE(SUM(pay.amount), 0)           AS earned,
              COUNT(*) FILTER (WHERE bk.care_credit_id IS NOT NULL)::int AS via_credit,
              COALESCE(SUM(pay.amount) FILTER (WHERE bk.care_credit_id IS NOT NULL), 0) AS from_barangays
         FROM booking bk
         LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
        WHERE bk.psychologist_id = $1
          AND bk.status = 'completed'
          AND bk.schedule >= $2::date
          AND bk.schedule < $3::date + 1
        GROUP BY month
        ORDER BY month DESC`,
      [id, p.from, p.to]
    );

    const totals = rows.reduce(
      (t, r) => ({
        sessions: t.sessions + r.sessions,
        earned: t.earned + Number(r.earned),
        from_barangays: t.from_barangays + Number(r.from_barangays),
        hours: t.hours + r.minutes / 60,
      }),
      { sessions: 0, earned: 0, from_barangays: 0, hours: 0 }
    );

    // Pending is money owed but not yet earned: a confirmed future session.
    const { rows: pending } = await query(
      `SELECT COALESCE(SUM(pay.amount), 0) AS amount, COUNT(*)::int AS sessions
         FROM booking bk
         LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
        WHERE bk.psychologist_id = $1 AND bk.status = 'confirmed' AND bk.schedule > now()`,
      [id]
    );

    if (req.query.format === 'csv') {
      return sendCsv(res, {
        rows,
        name: 'earnings-report',
        period: p,
        meta: {
          report: 'Earnings report',
          psychologist: req.user.name,
          period: `${p.from} to ${p.to}`,
          generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
          total_earned: totals.earned.toFixed(2),
          funded_by_barangays: totals.from_barangays.toFixed(2),
          note: 'Counted when a session is marked complete. Excludes confirmed future sessions.',
        },
        columns: [
          { key: 'month',          label: 'Month' },
          { key: 'sessions',       label: 'Sessions' },
          { key: 'minutes',        label: 'Minutes' },
          { key: 'earned',         label: 'Earned' },
          { key: 'via_credit',     label: 'Paid by Care Credit' },
          { key: 'from_barangays', label: 'From barangay funding' },
        ],
      });
    }

    res.json({ period: p, totals, monthly: rows, pending: pending[0] });
  })
);

// ---------------------------------------------------------------------
// Accomplishment Report
// ---------------------------------------------------------------------

/**
 * Builds the report for one barangay, or for the whole city when
 * barangayId is null.
 *
 * This is the document a barangay captain takes to a budget meeting to
 * justify the line item, so it answers one question: what did the money
 * buy. Every figure is a count or a peso amount, and no resident appears.
 */
async function buildAccomplishment(barangayId, p) {
  const scope = barangayId ? 'barangay' : 'citywide';

  const [sessions, credits, engagement, crisis, byBarangay] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE bk.status = 'completed')::int   AS completed,
              COUNT(*) FILTER (WHERE bk.status = 'no_show')::int      AS missed,
              COUNT(*) FILTER (WHERE bk.status = 'cancelled')::int    AS cancelled,
              COUNT(*) FILTER (WHERE bk.session_type = 'group'
                               AND bk.status = 'completed')::int      AS group_sessions,
              COUNT(DISTINCT bk.resident_id) FILTER (
                WHERE bk.status = 'completed')::int                   AS residents_served,
              COUNT(DISTINCT bk.psychologist_id) FILTER (
                WHERE bk.status = 'completed')::int                   AS psychologists_used,
              COALESCE(SUM(bk.duration_min) FILTER (
                WHERE bk.status = 'completed'), 0)::int               AS minutes
         FROM booking bk
         JOIN "user" u ON u.user_id = bk.resident_id
        WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
          AND bk.schedule >= $2::date AND bk.schedule < $3::date + 1`,
      [barangayId, p.from, p.to]
    ),
    query(
      // Allocation is counted by when the credit was issued, consumption by
      // when the session happened. The two are different dates, and a report
      // that counts every credit ever issued would say the barangay spent
      // money it spent last year.
      `SELECT COUNT(*) FILTER (WHERE c.issued_at >= $2::date
                               AND c.issued_at < $3::date + 1)::int   AS allocated,
              COALESCE(SUM(c.amount) FILTER (WHERE c.issued_at >= $2::date
                               AND c.issued_at < $3::date + 1), 0)    AS value_allocated,
              COUNT(*) FILTER (WHERE c.status = 'consumed'
                               AND bk.schedule >= $2::date
                               AND bk.schedule < $3::date + 1)::int   AS used,
              COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'consumed'
                               AND bk.schedule >= $2::date
                               AND bk.schedule < $3::date + 1), 0)    AS value_used,
              -- These two are the position today, not over the period.
              COUNT(*) FILTER (WHERE c.resident_id IS NOT NULL
                               AND c.status = 'available')::int       AS with_residents,
              COUNT(*) FILTER (WHERE c.resident_id IS NULL
                               AND c.status = 'available')::int       AS in_pool
         FROM care_credit c
         LEFT JOIN booking bk ON bk.care_credit_id = c.credit_id
        WHERE ($1::bigint IS NULL OR c.barangay_id = $1)`,
      [barangayId, p.from, p.to]
    ),
    query(
      `SELECT (SELECT COUNT(*)::int FROM "user"
                WHERE role = 'resident' AND status = 'active'
                  AND ($1::bigint IS NULL OR barangay_id = $1))       AS registered,
              (SELECT COUNT(DISTINCT m.user_id)::int FROM mood_entry m
                 JOIN "user" u ON u.user_id = m.user_id
                WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
                  AND m.entry_date BETWEEN $2::date AND $3::date)     AS logged_mood,
              (SELECT COUNT(*)::int FROM mood_entry m
                 JOIN "user" u ON u.user_id = m.user_id
                WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
                  AND m.entry_date BETWEEN $2::date AND $3::date)     AS mood_entries,
              (SELECT COUNT(*)::int FROM assessment a
                 JOIN "user" u ON u.user_id = a.user_id
                WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
                  AND a.taken_at >= $2::date AND a.taken_at < $3::date + 1) AS assessments,
              (SELECT COUNT(*)::int FROM voice_journal v
                 JOIN "user" u ON u.user_id = v.user_id
                WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
                  AND v.created_at >= $2::date AND v.created_at < $3::date + 1) AS journals`,
      [barangayId, p.from, p.to]
    ),
    query(
      `SELECT COUNT(*)::int                                          AS raised,
              COUNT(*) FILTER (WHERE c.risk_level = 'severe')::int    AS severe,
              COUNT(*) FILTER (WHERE c.status = 'resolved')::int      AS resolved,
              COUNT(*) FILTER (WHERE c.booking_id IS NOT NULL)::int   AS led_to_session
         FROM crisis_alert c
         JOIN "user" u ON u.user_id = c.user_id
        WHERE ($1::bigint IS NULL OR u.barangay_id = $1)
          AND c.created_at >= $2::date AND c.created_at < $3::date + 1`,
      [barangayId, p.from, p.to]
    ),
    // Only for the citywide report: a per-barangay breakdown.
    barangayId
      ? Promise.resolve({ rows: [] })
      : query(
          `SELECT b.name AS barangay,
                  COUNT(*) FILTER (WHERE bk.status = 'completed')::int AS sessions,
                  COUNT(DISTINCT bk.resident_id) FILTER (
                    WHERE bk.status = 'completed')::int                AS residents,
                  COALESCE(SUM(pay.amount) FILTER (
                    WHERE bk.status = 'completed'), 0)                 AS spent
             FROM barangay b
             LEFT JOIN "user" u    ON u.barangay_id = b.barangay_id AND u.role = 'resident'
             LEFT JOIN booking bk  ON bk.resident_id = u.user_id
                                  AND bk.schedule >= $1::date
                                  AND bk.schedule < $2::date + 1
             LEFT JOIN payment pay ON pay.booking_id = bk.booking_id
            GROUP BY b.name
            HAVING COUNT(*) FILTER (WHERE bk.status = 'completed') > 0
            ORDER BY sessions DESC`,
          [p.from, p.to]
        ),
  ]);

  const e = engagement.rows[0];

  return {
    scope,
    period: p,
    sessions: {
      ...sessions.rows[0],
      hours: +(sessions.rows[0].minutes / 60).toFixed(1),
    },
    credits: credits.rows[0],
    engagement: {
      ...e,
      // Share of registered residents who used the service at all. The
      // honest measure of whether a subscription is reaching anyone.
      participation_rate: e.registered
        ? Math.round((e.logged_mood / e.registered) * 100)
        : 0,
    },
    crisis: crisis.rows[0],
    by_barangay: byBarangay.rows,
  };
}

/** 1. Generate Barangay Report. */
router.get(
  '/accomplishment',
  requireRole('lgu', 'admin'),
  asyncHandler(async (req, res) => {
    const p = period(req);

    // An admin may ask for the whole city; an LGU only ever gets its own.
    const citywide = req.user.role === 'admin' && req.query.scope === 'city';
    const barangayId = citywide ? null : req.user.barangay_id;

    const report = await buildAccomplishment(barangayId, p);

    const { rows: b } = barangayId
      ? await query('SELECT name FROM barangay WHERE barangay_id = $1', [barangayId])
      : { rows: [{ name: 'Cebu City' }] };
    report.subject = b[0]?.name ?? 'Unknown';

    if (req.query.format === 'csv') {
      // Flattened to one row per measure, because a summary report with
      // nested sections is not a table and pretending otherwise produces
      // a file nobody can use.
      const rows = [
        ['Sessions completed', report.sessions.completed],
        ['Sessions missed', report.sessions.missed],
        ['Sessions cancelled', report.sessions.cancelled],
        ['Group sessions', report.sessions.group_sessions],
        ['Hours delivered', report.sessions.hours],
        ['Residents served', report.sessions.residents_served],
        ['Psychologists engaged', report.sessions.psychologists_used],
        ['Care Credits allocated', report.credits.allocated],
        ['Care Credits used', report.credits.used],
        ['Care Credits held by residents', report.credits.with_residents],
        ['Care Credits unassigned', report.credits.in_pool],
        ['Value allocated', report.credits.value_allocated],
        ['Value used', report.credits.value_used],
        ['Registered residents', report.engagement.registered],
        ['Residents who logged mood', report.engagement.logged_mood],
        ['Mood entries', report.engagement.mood_entries],
        ['Assessments taken', report.engagement.assessments],
        ['Voice journals recorded', report.engagement.journals],
        ['Participation rate (%)', report.engagement.participation_rate],
        ['Crisis alerts raised', report.crisis.raised],
        ['Severe alerts', report.crisis.severe],
        ['Alerts resolved', report.crisis.resolved],
        ['Alerts that led to a session', report.crisis.led_to_session],
      ].map(([measure, value]) => ({ measure, value }));

      return sendCsv(res, {
        rows,
        name: `accomplishment-${report.subject}`,
        period: p,
        meta: {
          report: 'Accomplishment report',
          subject: report.subject,
          period: `${p.from} to ${p.to}`,
          generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
          generated_by: req.user.name,
          note: 'Aggregate figures only. No resident is identified in this report.',
        },
        columns: [
          { key: 'measure', label: 'Measure' },
          { key: 'value',   label: 'Value' },
        ],
      });
    }

    res.json({ report });
  })
);

/**
 * Save a generated report, so a barangay can show what was reported in
 * March without regenerating it from data that has since changed.
 */
router.post(
  '/accomplishment/save',
  requireRole('lgu', 'admin'),
  asyncHandler(async (req, res) => {
    const p = period(req);
    const citywide = req.user.role === 'admin' && req.query.scope === 'city';
    const barangayId = citywide ? null : req.user.barangay_id;

    const report = await buildAccomplishment(barangayId, p);

    const { rows } = await query(
      `INSERT INTO accomplishment_report
         (barangay_id, period_start, period_end, payload, generated_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING report_id, generated_at`,
      [barangayId, p.from, p.to, JSON.stringify(report), req.user.user_id]
    );

    res.status(201).json({ saved: rows[0] });
  })
);

router.get(
  '/accomplishment/saved',
  requireRole('lgu', 'admin'),
  asyncHandler(async (req, res) => {
    const citywide = req.user.role === 'admin' && req.query.scope === 'city';

    const { rows } = await query(
      `SELECT r.report_id, r.period_start, r.period_end, r.generated_at,
              u.name AS generated_by_name,
              b.name AS barangay_name
         FROM accomplishment_report r
         LEFT JOIN "user" u    ON u.user_id = r.generated_by
         LEFT JOIN barangay b  ON b.barangay_id = r.barangay_id
        WHERE ($1::boolean IS TRUE AND r.barangay_id IS NULL)
           OR ($1::boolean IS FALSE AND r.barangay_id = $2)
        ORDER BY r.generated_at DESC
        LIMIT 30`,
      [citywide, req.user.barangay_id]
    );

    res.json({ reports: rows });
  })
);

router.get(
  '/accomplishment/saved/:id',
  requireRole('lgu', 'admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.report_id, r.payload, r.generated_at, r.barangay_id,
              u.name AS generated_by_name
         FROM accomplishment_report r
         LEFT JOIN "user" u ON u.user_id = r.generated_by
        WHERE r.report_id = $1`,
      [req.params.id]
    );
    const r = rows[0];
    if (!r) throw ApiError.notFound('No such report.');

    // An LGU may only reopen its own, and citywide reports are admin-only.
    if (req.user.role !== 'admin' && String(r.barangay_id) !== String(req.user.barangay_id))
      throw ApiError.forbidden('That report belongs to another barangay.');

    res.json({ report: r.payload, generated_at: r.generated_at,
               generated_by_name: r.generated_by_name });
  })
);

export default router;
