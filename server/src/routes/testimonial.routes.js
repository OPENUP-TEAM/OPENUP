import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { SEVERE_PHRASES, HIGH_PHRASES } from '../services/crisis-vocabulary.js';
import { raiseCrisisAlert, getHotlines } from '../services/crisis.service.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Community Testimonials (Joan Aballe)
//   1-3. Create / Edit / Delete Post
//   4-6. Create / Edit / Delete Comment
//
// Module: Community Testimonials Moderation (Marinelle Cebe)
//   1. Review Flagged Content  2. Keep  3. Remove
// ---------------------------------------------------------------------

/**
 * The same safety floor the journal and companion use.
 *
 * Someone posting "wala nay pulos, magpakamatay ko" to a community board
 * is disclosing in public rather than in a private journal. Treating a
 * post as ordinary content because it was typed into a different box
 * would be an arbitrary gap in the safety net.
 */
function crisisFloor(text) {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ')} `;
  const hit = (list) => list.find((m) => t.includes(` ${m} `) || t.includes(m));
  if (hit(SEVERE_PHRASES)) return 'severe';
  if (hit(HIGH_PHRASES)) return 'high';
  return null;
}

/** Who wrote something, respecting the anonymous flag. */
const authorLabel = (row) =>
  row.is_anonymous ? row.display_alias || 'Anonymous' : row.author_name;

/** 1. View the board. Removed content is invisible to everyone but admins. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';

    const { rows } = await query(
      `SELECT t.testimonial_id, t.content, t.status, t.is_anonymous,
              t.created_at, t.updated_at, t.user_id,
              u.name AS author_name, u.display_alias,
              (SELECT COUNT(*)::int FROM comment c
                WHERE c.testimonial_id = t.testimonial_id
                  AND c.status = 'visible')                       AS comment_count,
              EXISTS (SELECT 1 FROM content_flag f
                       WHERE f.content_type = 'testimonial'
                         AND f.content_id = t.testimonial_id
                         AND f.reported_by = $1)                  AS i_reported
         FROM testimonial t
         JOIN "user" u ON u.user_id = t.user_id
        WHERE ($2::boolean IS TRUE OR t.status <> 'removed')
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [req.user.user_id, isAdmin]
    );

    res.json({
      posts: rows.map((r) => ({
        testimonial_id: r.testimonial_id,
        content: r.content,
        status: r.status,
        author: authorLabel(r),
        is_mine: String(r.user_id) === String(req.user.user_id),
        is_anonymous: r.is_anonymous,
        comment_count: r.comment_count,
        i_reported: r.i_reported,
        created_at: r.created_at,
        edited: r.updated_at > r.created_at,
      })),
    });
  })
);

/** 1. Create Post. */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'resident')
      throw ApiError.forbidden('Only residents can post here.');

    const { content, is_anonymous } = z
      .object({
        content: z.string().trim().min(10, 'Write a little more than that.').max(2000),
        is_anonymous: z.boolean().default(true),
      })
      .parse(req.body);

    const { rows } = await query(
      `INSERT INTO testimonial (user_id, content, is_anonymous)
       VALUES ($1, $2, $3) RETURNING testimonial_id, created_at`,
      [req.user.user_id, content, is_anonymous]
    );

    // A public post is still a disclosure.
    let crisis = null;
    const level = crisisFloor(content);
    if (level) {
      const alert = await raiseCrisisAlert({
        userId: req.user.user_id,
        source: 'testimonial',
        sourceId: rows[0].testimonial_id,
        riskLevel: level,
      });
      crisis = {
        hotlines: alert.hotlines,
        contact_alerted: alert.contact_alerted,
        message:
          'Thank you for saying this out loud. What you wrote suggests you are carrying something heavy, and someone should be with you for it.',
      };
    }

    res.status(201).json({ testimonial_id: rows[0].testimonial_id, crisis });
  })
);

/** 2. Edit Post. */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { content, is_anonymous } = z
      .object({
        content: z.string().trim().min(10).max(2000).optional(),
        is_anonymous: z.boolean().optional(),
      })
      .parse(req.body);

    const { rows } = await query(
      `UPDATE testimonial
          SET content      = COALESCE($3, content),
              is_anonymous = COALESCE($4, is_anonymous)
        WHERE testimonial_id = $1 AND user_id = $2 AND status <> 'removed'
        RETURNING testimonial_id`,
      [req.params.id, req.user.user_id, content ?? null, is_anonymous ?? null]
    );
    if (!rows.length) throw ApiError.notFound('That post is not yours, or was removed.');

    res.json({ ok: true });
  })
);

/** 3. Delete Post. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'DELETE FROM testimonial WHERE testimonial_id = $1 AND user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (!rowCount) throw ApiError.notFound('That post is not yours.');
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------

router.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const { rows } = await query(
      `SELECT c.comment_id, c.content, c.status, c.created_at, c.user_id,
              u.name AS author_name, u.display_alias,
              t.is_anonymous AS post_anonymous,
              EXISTS (SELECT 1 FROM content_flag f
                       WHERE f.content_type = 'comment'
                         AND f.content_id = c.comment_id
                         AND f.reported_by = $1) AS i_reported
         FROM comment c
         JOIN "user" u      ON u.user_id = c.user_id
         JOIN testimonial t ON t.testimonial_id = c.testimonial_id
        WHERE c.testimonial_id = $2
          AND ($3::boolean IS TRUE OR c.status <> 'removed')
        ORDER BY c.created_at`,
      [req.user.user_id, req.params.id, isAdmin]
    );

    res.json({
      comments: rows.map((r) => ({
        comment_id: r.comment_id,
        content: r.content,
        status: r.status,
        // Psychologists answer under their own name; residents under an alias.
        author: r.display_alias || r.author_name,
        is_mine: String(r.user_id) === String(req.user.user_id),
        i_reported: r.i_reported,
        created_at: r.created_at,
      })),
    });
  })
);

/** 4. Create Comment. */
router.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { content } = z
      .object({ content: z.string().trim().min(2).max(1000) })
      .parse(req.body);

    const { rows: post } = await query(
      `SELECT testimonial_id, user_id, status FROM testimonial WHERE testimonial_id = $1`,
      [req.params.id]
    );
    if (!post.length || post[0].status === 'removed')
      throw ApiError.notFound('That post is no longer available.');

    const { rows } = await query(
      `INSERT INTO comment (testimonial_id, user_id, content)
       VALUES ($1, $2, $3) RETURNING comment_id, created_at`,
      [req.params.id, req.user.user_id, content]
    );

    if (String(post[0].user_id) !== String(req.user.user_id)) {
      await notify(null, post[0].user_id,
        'Someone replied to your post.', 'message', '/app/community');
    }

    res.status(201).json({ comment_id: rows[0].comment_id });
  })
);

/** 5. Edit Comment. */
router.patch(
  '/comments/:commentId',
  asyncHandler(async (req, res) => {
    const { content } = z
      .object({ content: z.string().trim().min(2).max(1000) })
      .parse(req.body);

    const { rowCount } = await query(
      `UPDATE comment SET content = $3
        WHERE comment_id = $1 AND user_id = $2 AND status <> 'removed'`,
      [req.params.commentId, req.user.user_id, content]
    );
    if (!rowCount) throw ApiError.notFound('That comment is not yours, or was removed.');
    res.json({ ok: true });
  })
);

/** 6. Delete Comment. */
router.delete(
  '/comments/:commentId',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'DELETE FROM comment WHERE comment_id = $1 AND user_id = $2',
      [req.params.commentId, req.user.user_id]
    );
    if (!rowCount) throw ApiError.notFound('That comment is not yours.');
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------
// Reporting and moderation
// ---------------------------------------------------------------------

/**
 * Report something.
 *
 * Flagging does not hide the content. One person objecting is not proof
 * of anything, and auto-hiding would let anyone silence a post they
 * disliked. A human decides.
 */
router.post(
  '/report',
  asyncHandler(async (req, res) => {
    const { content_type, content_id, reason } = z
      .object({
        content_type: z.enum(['testimonial', 'comment']),
        content_id: z.coerce.number().int().positive(),
        reason: z.string().trim().min(5, 'Say briefly what is wrong with it.').max(255),
      })
      .parse(req.body);

    const { rowCount: already } = await query(
      `SELECT 1 FROM content_flag
        WHERE content_type = $1 AND content_id = $2 AND reported_by = $3`,
      [content_type, content_id, req.user.user_id]
    );
    if (already) throw ApiError.conflict('You have already reported this.');

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO content_flag (content_type, content_id, reported_by, reason)
         VALUES ($1, $2, $3, $4)`,
        [content_type, content_id, req.user.user_id, reason]
      );

      // Marked as flagged so moderators can find it, still visible to readers.
      const table = content_type === 'testimonial' ? 'testimonial' : 'comment';
      const idCol = content_type === 'testimonial' ? 'testimonial_id' : 'comment_id';
      await client.query(
        `UPDATE ${table} SET status = 'flagged' WHERE ${idCol} = $1 AND status = 'visible'`,
        [content_id]
      );

      const { rows: admins } = await client.query(
        `SELECT user_id FROM "user" WHERE role = 'admin' AND status = 'active'`
      );
      await Promise.all(
        admins.map((a) =>
          notify(client, a.user_id, 'Community content was reported.',
            'system', '/admin/moderation')
        )
      );
    });

    res.status(201).json({ ok: true });
  })
);

/** 1. Review Flagged Content. */
router.get(
  '/moderation/queue',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const status = z
      .enum(['pending', 'kept', 'removed', 'all'])
      .default('pending')
      .parse(req.query.status ?? 'pending');

    const { rows } = await query(
      `SELECT f.flag_id, f.content_type, f.content_id, f.reason, f.status,
              f.created_at,
              reporter.display_alias AS reporter_alias,
              reviewer.name          AS reviewed_by_name,
              COALESCE(t.content, c.content)                       AS content,
              COALESCE(t.status, c.status)                         AS content_status,
              COALESCE(ta.display_alias, ca.display_alias)         AS author_alias,
              COALESCE(ta.name, ca.name)                           AS author_name,
              COALESCE(ta.user_id, ca.user_id)                     AS author_id,
              (SELECT COUNT(*)::int FROM content_flag f2
                WHERE f2.content_type = f.content_type
                  AND f2.content_id = f.content_id)                AS report_count
         FROM content_flag f
         LEFT JOIN "user" reporter ON reporter.user_id = f.reported_by
         LEFT JOIN "user" reviewer ON reviewer.user_id = f.reviewed_by
         LEFT JOIN testimonial t   ON f.content_type = 'testimonial'
                                  AND t.testimonial_id = f.content_id
         LEFT JOIN "user" ta       ON ta.user_id = t.user_id
         LEFT JOIN comment c       ON f.content_type = 'comment'
                                  AND c.comment_id = f.content_id
         LEFT JOIN "user" ca       ON ca.user_id = c.user_id
        WHERE ($1 = 'all' OR f.status = $1)
        ORDER BY f.created_at DESC`,
      [status]
    );

    res.json({ flags: rows.filter((r) => r.content !== null) });
  })
);

/** 2. Keep Content / 3. Remove Content. */
router.patch(
  '/moderation/:flagId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { decision, note } = z
      .object({
        decision: z.enum(['keep', 'remove']),
        note: z.string().trim().max(255).optional(),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT flag_id, content_type, content_id, status
           FROM content_flag WHERE flag_id = $1 FOR UPDATE`,
        [req.params.flagId]
      );
      const f = rows[0];
      if (!f) throw ApiError.notFound('No such report.');
      if (f.status !== 'pending') throw ApiError.conflict('That report was already reviewed.');

      const table = f.content_type === 'testimonial' ? 'testimonial' : 'comment';
      const idCol = f.content_type === 'testimonial' ? 'testimonial_id' : 'comment_id';

      // One decision settles every report against the same content.
      await client.query(
        `UPDATE content_flag
            SET status = $3, reviewed_by = $4
          WHERE content_type = $1 AND content_id = $2 AND status = 'pending'`,
        [f.content_type, f.content_id, decision === 'keep' ? 'kept' : 'removed',
         req.user.user_id]
      );

      const { rows: content } = await client.query(
        `UPDATE ${table} SET status = $2 WHERE ${idCol} = $1 RETURNING user_id`,
        [f.content_id, decision === 'keep' ? 'visible' : 'removed']
      );

      if (decision === 'remove' && content.length) {
        await notify(client, content[0].user_id,
          `Something you posted was removed after review.${note ? ` ${note}` : ''}`,
          'system', '/app/community');
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.user_id, `moderation.${decision}`, f.content_type, f.content_id,
         { flag_id: f.flag_id, note: note ?? null }]
      );

      return f;
    });

    res.json({ ok: true, flag_id: result.flag_id, decision });
  })
);

/** Hotlines, for the crisis panel after a post. */
router.get(
  '/support/hotlines',
  asyncHandler(async (_req, res) => res.json({ hotlines: await getHotlines() }))
);

export default router;
