import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { signLicenseUrl } from '../config/storage.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------
// Module: Psychologist Verification (Marinelle Cebe)
//   1. Review Credentials
//   2. Approve Psychologist
//   3. Reject Psychologist
// ---------------------------------------------------------------------

/** 1. Review Credentials — the queue of applications awaiting a decision. */
router.get(
  '/verification',
  asyncHandler(async (req, res) => {
    const status = z
      .enum(['pending', 'verified', 'rejected', 'all'])
      .default('pending')
      .parse(req.query.status ?? 'pending');

    const { rows } = await query(
      `SELECT p.psychologist_id,
              p.license_no,
              p.specialization,
              p.languages,
              p.bio,
              p.rate_per_hour,
              p.license_doc_url,
              p.is_verified,
              p.verified_at,
              u.user_id,
              u.name,
              u.email,
              u.status,
              u.created_at,
              b.name AS barangay_name,
              reviewer.name AS reviewed_by_name
         FROM psychologist p
         JOIN "user" u        ON u.user_id = p.user_id
         JOIN barangay b      ON b.barangay_id = u.barangay_id
         LEFT JOIN "user" reviewer ON reviewer.user_id = p.verified_by
        WHERE CASE $1
                WHEN 'pending'  THEN u.status = 'pending'
                WHEN 'verified' THEN p.is_verified = true
                WHEN 'rejected' THEN u.status = 'rejected'
                ELSE true
              END
        ORDER BY u.created_at ASC`,
      [status]
    );

    // Documents live in a private bucket, so mint a short-lived signed URL
    // for each one rather than storing anything publicly reachable.
    const applications = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        license_doc_url: undefined,
        has_document: Boolean(r.license_doc_url),
        document_url: r.license_doc_url
          ? await signLicenseUrl(r.license_doc_url).catch(() => null)
          : null,
      }))
    );

    res.json({ applications, count: applications.length });
  })
);

/** Counts for the admin dashboard's pending-tasks panel. */
router.get(
  '/verification/summary',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT COUNT(*) FILTER (WHERE u.status = 'pending')::int          AS pending,
              COUNT(*) FILTER (WHERE p.is_verified)::int                 AS verified,
              COUNT(*) FILTER (WHERE u.status = 'pending'
                               AND p.license_doc_url IS NULL)::int       AS awaiting_document
         FROM psychologist p JOIN "user" u ON u.user_id = p.user_id`
    );
    res.json(rows[0]);
  })
);

/** 2. Approve Psychologist. */
router.patch(
  '/verification/:id/approve',
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT p.psychologist_id, p.license_no, p.license_doc_url,
                p.is_verified, u.user_id, u.name, u.status
           FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
          WHERE p.psychologist_id = $1
          FOR UPDATE OF p`,
        [req.params.id]
      );
      const app = rows[0];
      if (!app) throw ApiError.notFound('No such application.');
      if (app.is_verified) throw ApiError.conflict('That psychologist is already verified.');

      // A license number alone is not evidence. Require the document.
      if (!app.license_doc_url)
        throw ApiError.badRequest(
          'This applicant has not uploaded a license document yet, so there is nothing to verify.'
        );

      await client.query(
        `UPDATE psychologist
            SET is_verified = true, verified_at = now(), verified_by = $2
          WHERE psychologist_id = $1`,
        [app.psychologist_id, req.user.user_id]
      );

      // Approval is what makes the account usable.
      await client.query(`UPDATE "user" SET status = 'active' WHERE user_id = $1`, [app.user_id]);

      await notify(
        client,
        app.user_id,
        'Your license was verified. You can now accept counseling sessions.',
        'system',
        '/psychologist'
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'psychologist.approve', 'psychologist', $2, $3)`,
        [req.user.user_id, app.psychologist_id, { license_no: app.license_no }]
      );

      return app;
    });

    res.json({ ok: true, psychologist_id: result.psychologist_id, status: 'verified' });
  })
);

/** 3. Reject Psychologist. */
router.patch(
  '/verification/:id/reject',
  asyncHandler(async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().min(10, 'Give the applicant a usable reason (10 characters or more).').max(500) })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT p.psychologist_id, p.is_verified, u.user_id
           FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
          WHERE p.psychologist_id = $1
          FOR UPDATE OF p`,
        [req.params.id]
      );
      const app = rows[0];
      if (!app) throw ApiError.notFound('No such application.');
      if (app.is_verified)
        throw ApiError.conflict(
          'That psychologist is already verified. Suspend the account instead of rejecting it.'
        );

      await client.query(
        `UPDATE psychologist SET verified_by = $2, verified_at = now()
          WHERE psychologist_id = $1`,
        [app.psychologist_id, req.user.user_id]
      );
      // 'rejected', not 'suspended': the applicant must be able to sign in
      // to read the reason and upload a corrected document.
      await client.query(`UPDATE "user" SET status = 'rejected' WHERE user_id = $1`, [app.user_id]);

      await notify(
        client,
        app.user_id,
        `Your license could not be verified: ${reason}`,
        'system',
        null
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'psychologist.reject', 'psychologist', $2, $3)`,
        [req.user.user_id, app.psychologist_id, { reason }]
      );

      return app;
    });

    res.json({ ok: true, psychologist_id: result.psychologist_id, status: 'rejected' });
  })
);

export default router;
