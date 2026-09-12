import { Router } from 'express';
import multer from 'multer';
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

export default router;