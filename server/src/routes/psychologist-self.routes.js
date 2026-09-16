import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadLicense, signLicenseUrl, deleteLicense } from '../config/storage.js';

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

export default router;
