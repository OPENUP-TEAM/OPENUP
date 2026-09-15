import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadResource, signResourceUrl, deleteResource } from '../config/storage.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Wellness Resources (Joan Aballe, resident)
//   1. View Resources  2. Search Resources  3. Download Resources
//
// Module: Resources Management (Joan Aballe, admin)
//   1. Add  2. Edit  3. Delete  4. Publish
// ---------------------------------------------------------------------

const ALLOWED = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'audio/mpeg', 'audio/mp4', 'video/mp4',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.includes(file.mimetype)
      ? cb(null, true)
      : cb(new ApiError(400, 'Upload a PDF, image, audio, or MP4 file.')),
});

/** Categories that exist, for the filter chips. */
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const adminView = req.user.role === 'admin';
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS n
         FROM resource
        WHERE category IS NOT NULL
          AND ($1::boolean IS TRUE OR is_published = true)
        GROUP BY category ORDER BY category`,
      [adminView]
    );
    res.json({ categories: rows });
  })
);

/**
 * 1. View Resources, 2. Search Resources.
 *
 * Residents see published resources only. Admins see everything, so they
 * can work on a draft without it appearing half-finished to someone
 * looking for help.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const adminView = req.user.role === 'admin' && req.query.all === 'true';
    const { q, category } = req.query;

    const { rows } = await query(
      `SELECT r.resource_id, r.title, r.description, r.category,
              r.is_published, r.created_at,
              r.file_url IS NOT NULL AS has_file,
              u.name AS created_by_name,
              -- Body is often long; the list only needs to know it exists.
              (r.body IS NOT NULL AND length(r.body) > 0) AS has_body
         FROM resource r
         LEFT JOIN "user" u ON u.user_id = r.created_by
        WHERE ($1::boolean IS TRUE OR r.is_published = true)
          AND ($2::text IS NULL OR r.category = $2)
          AND ($3::text IS NULL OR
               r.title ILIKE '%' || $3 || '%' OR
               r.description ILIKE '%' || $3 || '%' OR
               r.body ILIKE '%' || $3 || '%')
        ORDER BY r.created_at DESC`,
      [adminView, category || null, q?.trim() || null]
    );

    res.json({ resources: rows });
  })
);

/** Full resource, including the body text. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.*, u.name AS created_by_name
         FROM resource r
         LEFT JOIN "user" u ON u.user_id = r.created_by
        WHERE r.resource_id = $1`,
      [req.params.id]
    );
    const r = rows[0];
    if (!r) throw ApiError.notFound('No such resource.');
    if (!r.is_published && req.user.role !== 'admin')
      throw ApiError.notFound('No such resource.');

    res.json({
      resource: { ...r, file_url: undefined, has_file: Boolean(r.file_url) },
    });
  })
);

/** 3. Download Resources — short-lived signed URL. */
router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT file_url, is_published, title FROM resource WHERE resource_id = $1',
      [req.params.id]
    );
    const r = rows[0];
    if (!r) throw ApiError.notFound('No such resource.');
    if (!r.is_published && req.user.role !== 'admin')
      throw ApiError.notFound('No such resource.');
    if (!r.file_url) throw ApiError.notFound('This resource has no file to download.');

    res.json({ download_url: await signResourceUrl(r.file_url), title: r.title });
  })
);

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------

const ADMIN = requireRole('admin');

const bodySchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  category: z.string().trim().max(50).optional().or(z.literal('')),
  body: z.string().trim().max(50000).optional().or(z.literal('')),
  is_published: z.coerce.boolean().default(false),
});

/** 1. Add Resource. Accepts an optional file alongside the fields. */
router.post(
  '/',
  ADMIN,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const data = bodySchema.parse(req.body);

    if (!data.body && !req.file)
      throw ApiError.badRequest('Add some text or attach a file, otherwise there is nothing to read.');

    const path = req.file ? await uploadResource(req.file) : null;

    const { rows } = await query(
      `INSERT INTO resource
         (title, description, category, body, file_url, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING resource_id, title, is_published`,
      [data.title, data.description || null, data.category || null,
       data.body || null, path, data.is_published, req.user.user_id]
    );

    res.status(201).json({ resource: rows[0] });
  })
);

/** 2. Edit Resource. */
router.patch(
  '/:id',
  ADMIN,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const data = bodySchema.partial().parse(req.body);

    const { rows: existing } = await query(
      'SELECT file_url FROM resource WHERE resource_id = $1',
      [req.params.id]
    );
    if (!existing.length) throw ApiError.notFound('No such resource.');

    const path = req.file ? await uploadResource(req.file) : undefined;

    const { rows } = await query(
      `UPDATE resource
          SET title        = COALESCE($2, title),
              description  = COALESCE($3, description),
              category     = COALESCE($4, category),
              body         = COALESCE($5, body),
              file_url     = COALESCE($6, file_url),
              is_published = COALESCE($7, is_published)
        WHERE resource_id = $1
        RETURNING resource_id, title, is_published`,
      [req.params.id, data.title ?? null, data.description ?? null,
       data.category ?? null, data.body ?? null, path ?? null,
       data.is_published ?? null]
    );

    // Replace rather than accumulate orphaned files in storage.
    if (path && existing[0].file_url) deleteResource(existing[0].file_url).catch(() => {});

    res.json({ resource: rows[0] });
  })
);

/** 4. Publish Resource — the toggle on its own, since it is the common action. */
router.patch(
  '/:id/publish',
  ADMIN,
  asyncHandler(async (req, res) => {
    const { is_published } = z.object({ is_published: z.boolean() }).parse(req.body);

    const { rows } = await query(
      `UPDATE resource SET is_published = $2 WHERE resource_id = $1
        RETURNING resource_id, title, is_published`,
      [req.params.id, is_published]
    );
    if (!rows.length) throw ApiError.notFound('No such resource.');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, $2, 'resource', $3, $4)`,
      [req.user.user_id, is_published ? 'resource.publish' : 'resource.unpublish',
       req.params.id, { title: rows[0].title }]
    );

    res.json({ resource: rows[0] });
  })
);

/** 3. Delete Resource. */
router.delete(
  '/:id',
  ADMIN,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'DELETE FROM resource WHERE resource_id = $1 RETURNING file_url, title',
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('No such resource.');
    if (rows[0].file_url) deleteResource(rows[0].file_url).catch(() => {});

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'resource.delete', 'resource', $2, $3)`,
      [req.user.user_id, req.params.id, { title: rows[0].title }]
    );

    res.json({ ok: true });
  })
);

export default router;
