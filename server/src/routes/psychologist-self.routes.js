import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole, requireVerifiedPsychologist } from '../middleware/auth.js';
import { uploadLicense, signLicenseUrl, deleteLicense } from '../config/storage.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('psychologist'));

// PRC licenses are a photo or a scan. Anything else is a mistake or an attack.
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.includes(file.mimetype)
      ? cb(null, true)
      : cb(new ApiError(400, 'Upload a JPG, PNG, WebP, or PDF.')),
});

/**
 * The applicant's own verification status.
 *
 * Reachable while status is 'pending', which is the point: a psychologist
 * who cannot see their own progress has no way to know whether to wait or
 * re-upload.
 */
router.get(
  '/verification',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT p.psychologist_id, p.license_no, p.is_verified, p.verified_at,
              p.license_doc_url, p.specialization, p.languages, p.rate_per_hour,
              u.status
         FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
        WHERE p.user_id = $1`,
      [req.user.user_id]
    );
    const p = rows[0];
    if (!p) throw ApiError.notFound('No psychologist profile on this account.');

    // Most recent rejection reason, so the applicant knows what to fix.
    const { rows: notes } = await query(
      `SELECT message, created_at FROM notification
        WHERE user_id = $1 AND message LIKE 'Your license could not be verified%'
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.user_id]
    );

    const state = p.is_verified
      ? 'verified'
      : p.status === 'rejected'
        ? 'rejected'
        : p.license_doc_url
          ? 'under_review'
          : 'awaiting_document';

    res.json({
      state,
      license_no: p.license_no,
      verified_at: p.verified_at,
      has_document: Boolean(p.license_doc_url),
      rejection_reason: state === 'rejected' ? notes[0]?.message ?? null : null,
    });
  })
);

/** Upload or replace the PRC license document. */
router.post(
  '/verification/document',
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Choose a file to upload.');

    const { rows } = await query(
      `SELECT p.psychologist_id, p.license_doc_url, p.is_verified
         FROM psychologist p WHERE p.user_id = $1`,
      [req.user.user_id]
    );
    const p = rows[0];
    if (!p) throw ApiError.notFound('No psychologist profile on this account.');
    if (p.is_verified)
      throw ApiError.conflict('Your license is already verified. Contact an administrator to change it.');

    const path = await uploadLicense(p.psychologist_id, req.file);

    // Replace rather than accumulate, so the admin always reviews the
    // current document and old copies of personal data do not linger.
    const previous = p.license_doc_url;

    await query(
      `UPDATE psychologist
          SET license_doc_url = $2, verified_at = NULL, verified_by = NULL
        WHERE psychologist_id = $1`,
      [p.psychologist_id, path]
    );

    // A rejected applicant who uploads a corrected document goes back into
    // the review queue, rather than staying rejected with no way forward.
    await query(
      `UPDATE "user" SET status = 'pending'
        WHERE user_id = $1 AND status = 'rejected'`,
      [req.user.user_id]
    );

    if (previous) deleteLicense(previous).catch(() => {});

    // Nothing told an administrator a licence was waiting, so an applicant
    // could sit in "under review" until someone happened to open the queue.
    const { rows: admins } = await query(
      `SELECT user_id FROM "user" WHERE role = 'admin' AND status = 'active'`
    );
    await Promise.all(
      admins.map((a) =>
        notify(null, a.user_id,
          previous
            ? 'A psychologist replaced their license document. It needs reviewing again.'
            : 'A psychologist uploaded a license document for review.',
          'system', '/admin/verification')
      )
    );

    res.status(201).json({ ok: true, state: 'under_review' });
  })
);

/** The applicant's own document, for confirming the right file uploaded. */
router.get(
  '/verification/document',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT license_doc_url FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    const path = rows[0]?.license_doc_url;
    if (!path) throw ApiError.notFound('No document uploaded yet.');
    res.json({ document_url: await signLicenseUrl(path) });
  })
);


// ---------------------------------------------------------------------
// Module: Psychologist Dashboard (Joan Aballe)
//   1. Manage Availability / Calendar
//   2. View Scheduled Sessions   (served by /api/bookings)
//   3. Track Earnings
// ---------------------------------------------------------------------

/** Weekly availability windows. */
router.get(
  '/availability',
  asyncHandler(async (req, res) => {
    const { rows: p } = await query(
      'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!p.length) throw ApiError.notFound('No psychologist profile on this account.');

    const { rows } = await query(
      `SELECT availability_id, day_of_week, start_time, end_time, is_active
         FROM availability WHERE psychologist_id = $1
        ORDER BY day_of_week, start_time`,
      [p[0].psychologist_id]
    );
    res.json({ availability: rows });
  })
);

/**
 * Add a window.
 *
 * Overlapping windows on the same day would generate duplicate booking
 * slots, so they are rejected rather than merged: a psychologist who typed
 * the wrong time should be told, not silently corrected.
 */
router.post(
  '/availability',
  asyncHandler(async (req, res) => {
    const { day_of_week, start_time, end_time } = z
      .object({
        day_of_week: z.coerce.number().int().min(0).max(6),
        start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.'),
        end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.'),
      })
      .parse(req.body);

    if (end_time <= start_time)
      throw ApiError.badRequest('The end time has to be after the start time.');

    const { rows: p } = await query(
      'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!p.length) throw ApiError.notFound('No psychologist profile on this account.');

    const { rowCount: overlap } = await query(
      `SELECT 1 FROM availability
        WHERE psychologist_id = $1 AND day_of_week = $2 AND is_active
          AND $3::time < end_time AND $4::time > start_time`,
      [p[0].psychologist_id, day_of_week, start_time, end_time]
    );
    if (overlap)
      throw ApiError.conflict('That overlaps a window you already have on this day.');

    const { rows } = await query(
      `INSERT INTO availability (psychologist_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING availability_id, day_of_week, start_time, end_time, is_active`,
      [p[0].psychologist_id, day_of_week, start_time, end_time]
    );
    res.status(201).json({ window: rows[0] });
  })
);

/**
 * Remove a window.
 *
 * Bookings already made inside it are left alone. Clearing a Tuesday
 * should stop new bookings, not cancel the resident who booked last week.
 */
router.delete(
  '/availability/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `DELETE FROM availability
        WHERE availability_id = $1
          AND psychologist_id = (SELECT psychologist_id FROM psychologist WHERE user_id = $2)
        RETURNING day_of_week`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) throw ApiError.notFound('No such availability window.');

    const { rows: upcoming } = await query(
      `SELECT COUNT(*)::int AS n FROM booking b
         JOIN psychologist p ON p.psychologist_id = b.psychologist_id
        WHERE p.user_id = $1 AND b.status IN ('pending','confirmed')
          AND b.schedule > now()
          AND EXTRACT(DOW FROM b.schedule) = $2`,
      [req.user.user_id, rows[0].day_of_week]
    );

    res.json({
      ok: true,
      existing_bookings: upcoming[0].n,
      note: upcoming[0].n
        ? 'Sessions already booked on this day still stand. Cancel them separately if you cannot attend.'
        : null,
    });
  })
);

/** 3. Track Earnings. */
router.get(
  '/earnings',
  asyncHandler(async (req, res) => {
    const { rows: p } = await query(
      'SELECT psychologist_id, rate_per_hour FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!p.length) throw ApiError.notFound('No psychologist profile on this account.');
    const id = p[0].psychologist_id;

    const [totals, monthly, upcoming] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (WHERE b.status = 'completed')::int          AS sessions_completed,
           COALESCE(SUM(pay.amount) FILTER (WHERE b.status = 'completed'), 0) AS earned,
           COALESCE(SUM(pay.amount) FILTER (WHERE b.status = 'confirmed'
                                            AND b.schedule > now()), 0) AS scheduled_value,
           COUNT(*) FILTER (WHERE b.status = 'no_show')::int            AS missed
         FROM booking b
         LEFT JOIN payment pay ON pay.booking_id = b.booking_id
        WHERE b.psychologist_id = $1`,
        [id]
      ),
      query(
        `SELECT date_trunc('month', b.schedule)::date AS month,
                COUNT(*)::int                          AS sessions,
                COALESCE(SUM(pay.amount), 0)           AS earned
           FROM booking b
           LEFT JOIN payment pay ON pay.booking_id = b.booking_id
          WHERE b.psychologist_id = $1 AND b.status = 'completed'
            AND b.schedule >= date_trunc('month', now()) - INTERVAL '5 months'
          GROUP BY month ORDER BY month`,
        [id]
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM booking
          WHERE psychologist_id = $1 AND status = 'confirmed' AND schedule > now()`,
        [id]
      ),
    ]);

    res.json({
      rate_per_hour: Number(p[0].rate_per_hour),
      ...totals.rows[0],
      upcoming_count: upcoming.rows[0].n,
      monthly: monthly.rows,
    });
  })
);


// ---------------------------------------------------------------------
// Module: Client Management (Marinelle Cebe)
//   1. View Clients  2. View Session History  3. Add Progress Notes
//
// A client here is a resident who has booked with this psychologist. They
// appear under their display alias unless they chose to share their name,
// which is the same rule the booking list and chat follow. A psychologist
// does not need a legal name to remember who they spoke to on Tuesday.
// ---------------------------------------------------------------------

/** 1. View Clients. */
router.get(
  '/clients',
  asyncHandler(async (req, res) => {
    const { rows: me } = await query(
      'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!me.length) throw ApiError.notFound('No psychologist profile on this account.');

    const q = req.query.q?.trim() || null;

    const { rows } = await query(
      `SELECT u.user_id,
              COALESCE(u.display_alias, u.name)                        AS label,
              u.display_alias IS NULL                                  AS name_shared,
              b.name                                                   AS barangay_name,
              COUNT(*)::int                                            AS total_sessions,
              COUNT(*) FILTER (WHERE bk.status = 'completed')::int     AS completed,
              COUNT(*) FILTER (WHERE bk.status = 'no_show')::int        AS missed,
              MAX(bk.schedule) FILTER (WHERE bk.status = 'completed')  AS last_seen,
              MIN(bk.schedule) FILTER (WHERE bk.status = 'confirmed'
                                       AND bk.schedule > now())        AS next_session,
              (SELECT COUNT(*)::int FROM session_note n
                 JOIN booking nb ON nb.booking_id = n.booking_id
                WHERE nb.resident_id = u.user_id
                  AND n.psychologist_id = $1)                          AS note_count,
              -- Open crisis alerts matter more than any of the above.
              (SELECT COUNT(*)::int FROM crisis_alert c
                WHERE c.user_id = u.user_id AND c.status <> 'resolved') AS open_alerts
         FROM booking bk
         JOIN "user" u    ON u.user_id = bk.resident_id
         JOIN barangay b  ON b.barangay_id = u.barangay_id
        WHERE bk.psychologist_id = $1
          AND ($2::text IS NULL OR COALESCE(u.display_alias, u.name) ILIKE '%' || $2 || '%')
        GROUP BY u.user_id, u.display_alias, u.name, b.name
        ORDER BY open_alerts DESC, next_session NULLS LAST, last_seen DESC NULLS LAST`,
      [me[0].psychologist_id, q]
    );

    res.json({ clients: rows });
  })
);

/**
 * 2. View Session History, with the notes written against each session.
 *
 * Scoped to sessions this psychologist ran. Another psychologist's notes
 * about the same resident are not visible: the resident consented to
 * talking to one person, not to a shared file.
 */
router.get(
  '/clients/:residentId',
  asyncHandler(async (req, res) => {
    const { rows: me } = await query(
      'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!me.length) throw ApiError.notFound('No psychologist profile on this account.');
    const psychologistId = me[0].psychologist_id;

    const { rows: client } = await query(
      `SELECT u.user_id,
              COALESCE(u.display_alias, u.name) AS label,
              u.display_alias IS NULL           AS name_shared,
              b.name AS barangay_name
         FROM "user" u JOIN barangay b ON b.barangay_id = u.barangay_id
        WHERE u.user_id = $1
          AND EXISTS (SELECT 1 FROM booking
                       WHERE resident_id = u.user_id AND psychologist_id = $2)`,
      [req.params.residentId, psychologistId]
    );
    if (!client.length)
      throw ApiError.notFound('That resident has never booked with you.');

    const { rows: sessions } = await query(
      `SELECT bk.booking_id, bk.schedule, bk.status, bk.session_type, bk.duration_min,
              bk.care_credit_id IS NOT NULL AS covered_by_credit,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'note_id', n.note_id,
                          'content', n.content,
                          'created_at', n.created_at) ORDER BY n.created_at)
                   FROM session_note n
                  WHERE n.booking_id = bk.booking_id
                    AND n.psychologist_id = $2),
                '[]'::json) AS notes
         FROM booking bk
        WHERE bk.resident_id = $1 AND bk.psychologist_id = $2
        ORDER BY bk.schedule DESC`,
      [req.params.residentId, psychologistId]
    );

    // Alerts, without the content that raised them. A psychologist should
    // know a resident is at risk; the journal entry itself stays theirs
    // until they choose to talk about it.
    const { rows: alerts } = await query(
      `SELECT alert_id, source, risk_level, status, created_at
         FROM crisis_alert
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [req.params.residentId]
    );

    res.json({ client: client[0], sessions, alerts });
  })
);

/** 3. Add Progress Notes, against a specific session. */
router.post(
  '/clients/:residentId/notes',
  asyncHandler(async (req, res) => {
    const { booking_id, content } = z
      .object({
        booking_id: z.coerce.number().int().positive(),
        content: z.string().trim().min(1, 'The note is empty.').max(5000),
      })
      .parse(req.body);

    const { rows: me } = await query(
      'SELECT psychologist_id FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!me.length) throw ApiError.notFound('No psychologist profile on this account.');

    const { rows: ok } = await query(
      `SELECT booking_id FROM booking
        WHERE booking_id = $1 AND psychologist_id = $2 AND resident_id = $3`,
      [booking_id, me[0].psychologist_id, req.params.residentId]
    );
    if (!ok.length) throw ApiError.notFound('That session is not yours.');

    const { rows } = await query(
      `INSERT INTO session_note (booking_id, psychologist_id, content)
       VALUES ($1, $2, $3)
       RETURNING note_id, content, created_at`,
      [booking_id, me[0].psychologist_id, content]
    );

    res.status(201).json({ note: rows[0] });
  })
);


// ---------------------------------------------------------------------
// The crisis alert queue.
//
// crisis.service.js notifies every verified psychologist when an alert is
// raised and links them here. Until now that link went nowhere, which
// meant the escalation path ended in a notification nobody could act on.
//
// Resolving an alert asks whether it was a real concern. That answer is
// the only ground truth in the system: without a human saying so, the AI
// Effectiveness Tracker cannot report detection accuracy, and any number
// it showed would be invented.
// ---------------------------------------------------------------------

/** Open and recently resolved alerts, newest and most severe first. */
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const { rows: me } = await query(
      'SELECT psychologist_id, is_verified FROM psychologist WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!me.length) throw ApiError.notFound('No psychologist profile on this account.');
    if (!me[0].is_verified)
      throw ApiError.forbidden('Your license is still being reviewed.');

    const status = z
      .enum(['open', 'resolved', 'all'])
      .default('open')
      .parse(req.query.status ?? 'open');

    const { rows } = await query(
      `SELECT c.alert_id, c.source, c.risk_level, c.status, c.created_at,
              c.resolved_at, c.was_helpful, c.booking_id,
              c.handled_by = $1 AS handled_by_me,
              handler.name AS handled_by_name,
              -- The resident, under the name they chose. A psychologist has
              -- to be able to reach them; they do not need a legal name.
              COALESCE(u.display_alias, 'Resident ' || u.user_id) AS resident_label,
              u.user_id AS resident_id,
              b.name AS barangay_name,
              EXTRACT(DAY FROM now() - c.created_at)::int AS days_open,
              -- Whether this resident already has a session booked, so an
              -- alert that is already being handled is visible as such.
              EXISTS (SELECT 1 FROM booking bk
                       WHERE bk.resident_id = u.user_id
                         AND bk.status IN ('pending','confirmed')
                         AND bk.schedule > now())           AS has_upcoming_session,
              EXISTS (SELECT 1 FROM conversation cv
                       WHERE cv.resident_id = u.user_id
                         AND cv.status IN ('open','escalated')) AS has_open_chat
         FROM crisis_alert c
         JOIN "user" u    ON u.user_id = c.user_id
         JOIN barangay b  ON b.barangay_id = u.barangay_id
         LEFT JOIN psychologist hp ON hp.psychologist_id = c.handled_by
         LEFT JOIN "user" handler  ON handler.user_id = hp.user_id
        WHERE CASE $2
                WHEN 'open'     THEN c.status <> 'resolved'
                WHEN 'resolved' THEN c.status = 'resolved'
                ELSE true
              END
          AND ($2 <> 'resolved' OR c.resolved_at >= now() - INTERVAL '30 days')
        ORDER BY c.status = 'resolved',
                 CASE c.risk_level WHEN 'severe' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                 c.created_at
        LIMIT 100`,
      [me[0].psychologist_id, status]
    );

    res.json({ alerts: rows });
  })
);

/** Take an alert, so two psychologists do not both start reaching out. */
router.patch(
  '/alerts/:id/claim',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const claimed = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT alert_id, handled_by, status FROM crisis_alert
          WHERE alert_id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const a = rows[0];
      if (!a) throw ApiError.notFound('No such alert.');
      if (a.status === 'resolved') throw ApiError.conflict('That alert is already resolved.');
      if (a.handled_by && String(a.handled_by) !== String(req.psychologist.psychologist_id))
        throw ApiError.conflict('Another psychologist is already handling this.');

      await client.query(
        `UPDATE crisis_alert SET handled_by = $2, status = 'assigned'
          WHERE alert_id = $1`,
        [a.alert_id, req.psychologist.psychologist_id]
      );
      return a;
    });

    res.json({ ok: true, alert_id: claimed.alert_id });
  })
);

/**
 * Resolve an alert.
 *
 * `was_real` is the ground truth the effectiveness tracker needs, and the
 * question is asked plainly rather than inferred from whether a session
 * happened. Someone can be in genuine danger and decline a session; that
 * is a correct detection and a declined offer, not a false positive.
 */
router.patch(
  '/alerts/:id/resolve',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const { was_real, outcome, note } = z
      .object({
        was_real: z.boolean(),
        outcome: z.enum(['session_booked', 'spoke_with_them', 'referred_elsewhere',
                         'could_not_reach', 'no_action_needed']),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);

    const resolved = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE crisis_alert
            SET status = 'resolved',
                resolved_at = now(),
                was_helpful = $3,
                handled_by = COALESCE(handled_by, $2)
          WHERE alert_id = $1 AND status <> 'resolved'
          RETURNING alert_id, user_id, source, risk_level, created_at`,
        [req.params.id, req.psychologist.psychologist_id, was_real]
      );
      const a = rows[0];
      if (!a) throw ApiError.badRequest('That alert is already resolved.');

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'alert.resolve', 'crisis_alert', $2, $3)`,
        [req.user.user_id, a.alert_id,
         { was_real, outcome, source: a.source, risk_level: a.risk_level,
           note: note ?? null,
           hours_to_resolve: Math.round((Date.now() - new Date(a.created_at)) / 3600000) }]
      );

      return a;
    });

    res.json({ ok: true, alert_id: resolved.alert_id });
  })
);


/**
 * Open a conversation with the resident an alert belongs to.
 *
 * Psychologists cannot otherwise start a chat: conversations are begun by
 * residents, so that nobody receives an unsolicited message from a
 * stranger about their mental health. An open crisis alert is the one
 * exception, and a narrow one.
 *
 * What makes it defensible is that the resident asked for this, twice: the
 * alert exists because of something they wrote, and every path that raises
 * one tells them a psychologist may reach out. This route only widens that
 * to an actual message.
 *
 * The resident stays anonymous. Reaching out does not reveal their name.
 */
router.post(
  '/alerts/:id/outreach',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT c.alert_id, c.user_id, c.status, c.risk_level,
                COALESCE(u.display_alias, 'Resident ' || u.user_id) AS label
           FROM crisis_alert c
           JOIN "user" u ON u.user_id = c.user_id
          WHERE c.alert_id = $1
          FOR UPDATE OF c`,
        [req.params.id]
      );
      const a = rows[0];
      if (!a) throw ApiError.notFound('No such alert.');

      // Resolved means the concern was dealt with. Reopening a channel on
      // the strength of an old alert is not what the resident agreed to.
      if (a.status === 'resolved')
        throw ApiError.badRequest(
          'That alert is resolved. Reaching out now would not be covered by it.'
        );

      /*
       * Reuse an open thread rather than fragmenting the conversation, but
       * only one this psychologist is allowed to be in.
       *
       * Reusing any open conversation put a psychologist into a thread
       * another psychologist already owned, which the chat routes then
       * correctly refused. Worse, had it succeeded it would have dropped a
       * second professional into someone's crisis conversation unannounced.
       */
      const existing = await client.query(
        `SELECT conversation_id, psychologist_id FROM conversation
          WHERE resident_id = $1
            AND status IN ('open', 'escalated')
            AND (psychologist_id IS NULL OR psychologist_id = $2)
          ORDER BY created_at DESC LIMIT 1`,
        [a.user_id, req.psychologist.psychologist_id]
      );

      // Someone else is already in contact. Two psychologists messaging the
      // same person in crisis is worse than one, so this stops rather than
      // opening a competing thread.
      if (!existing.rowCount) {
        const { rows: other } = await client.query(
          `SELECT u.name FROM conversation c
             JOIN psychologist p ON p.psychologist_id = c.psychologist_id
             JOIN "user" u       ON u.user_id = p.user_id
            WHERE c.resident_id = $1 AND c.status IN ('open', 'escalated')
            LIMIT 1`,
          [a.user_id]
        );
        if (other.length)
          throw ApiError.conflict(
            `${other[0].name} is already in contact with this resident. Speak to them rather than opening a second conversation.`
          );
      }

      let conversationId;
      let reused = false;

      if (existing.rowCount) {
        conversationId = existing.rows[0].conversation_id;
        reused = true;
        // Claim it if nobody has, so the resident is not passed around.
        if (!existing.rows[0].psychologist_id) {
          await client.query(
            `UPDATE conversation
                SET psychologist_id = $2, status = 'escalated'
              WHERE conversation_id = $1`,
            [conversationId, req.psychologist.psychologist_id]
          );
        }
      } else {
        const { rows: created } = await client.query(
          `INSERT INTO conversation (resident_id, psychologist_id, is_anonymous, status)
           VALUES ($1, $2, true, 'escalated')
           RETURNING conversation_id`,
          [a.user_id, req.psychologist.psychologist_id]
        );
        conversationId = created.rows[0].conversation_id;
      }

      // Mark the alert as being handled, so two psychologists do not both
      // message the same person.
      await client.query(
        `UPDATE crisis_alert
            SET handled_by = COALESCE(handled_by, $2), status = 'assigned'
          WHERE alert_id = $1`,
        [a.alert_id, req.psychologist.psychologist_id]
      );

      await notify(client, a.user_id,
        'A psychologist has opened a chat with you.',
        'message', '/app/chat');

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'alert.outreach', 'crisis_alert', $2, $3)`,
        [req.user.user_id, a.alert_id,
         { conversation_id: conversationId, reused, risk_level: a.risk_level }]
      );

      return { conversationId, reused, label: a.label };
    });

    res.status(201).json({
      conversation_id: result.conversationId,
      reused: result.reused,
      resident_label: result.label,
    });
  })
);

export default router;
