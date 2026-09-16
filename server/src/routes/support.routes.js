import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { onlineUserIds } from '../services/presence.service.js';
import { getHotlines } from '../services/crisis.service.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('resident'));

/**
 * Shared crisis support endpoints.
 *
 * Used by the assessment, the voice journal, and the AI companion, so a
 * resident gets the same options whichever path surfaced the concern.
 */

/**
 * Who can actually take someone right now.
 *
 * Reports what is true rather than what is reassuring. If no psychologist is
 * connected, it says so, and the interface leads with the hotline instead
 * of a button that sends a person in distress into an empty room.
 */
router.get(
  '/availability',
  asyncHandler(async (req, res) => {
    const online = onlineUserIds();

    const { rows } = online.length
      ? await query(
          `SELECT p.psychologist_id, u.name, p.specialization, p.languages
             FROM psychologist p
             JOIN "user" u ON u.user_id = p.user_id
            WHERE p.is_verified = true
              AND u.status = 'active'
              AND u.user_id = ANY($1::bigint[])
            ORDER BY u.name`,
          [online]
        )
      : { rows: [] };

    // Psychologists whose working hours cover this moment, even if they are
    // not currently connected. They are worth waiting for; a psychologist
    // who finished at 5pm is not.
    const { rows: onDuty } = await query(
      `SELECT COUNT(DISTINCT p.psychologist_id)::int AS n
         FROM psychologist p
         JOIN "user" u        ON u.user_id = p.user_id
         JOIN availability a  ON a.psychologist_id = p.psychologist_id
        WHERE p.is_verified = true AND u.status = 'active' AND a.is_active
          AND a.day_of_week = EXTRACT(DOW FROM now())
          AND now()::time >= a.start_time
          AND now()::time <  a.end_time`
    );

    res.json({
      online_count: rows.length,
      psychologists: rows,
      on_duty_count: onDuty[0].n,
      hotlines: await getHotlines(),
    });
  })
);

/**
 * Open a priority chat with a psychologist, now.
 *
 * Reuses an existing open conversation rather than stacking new ones: a
 * resident who taps this three times in a bad ten minutes should land
 * back in the same thread, not create three queues for three psychologists.
 */
router.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT conversation_id, psychologist_id FROM conversation
          WHERE resident_id = $1 AND status IN ('open', 'escalated')
          ORDER BY created_at DESC LIMIT 1`,
        [req.user.user_id]
      );

      let conversationId;
      let alreadyClaimed = false;

      if (existing.rowCount) {
        conversationId = existing.rows[0].conversation_id;
        alreadyClaimed = Boolean(existing.rows[0].psychologist_id);
        await client.query(
          `UPDATE conversation SET status = 'escalated' WHERE conversation_id = $1`,
          [conversationId]
        );
      } else {
        const { rows } = await client.query(
          `INSERT INTO conversation (resident_id, is_anonymous, status)
           VALUES ($1, true, 'escalated') RETURNING conversation_id`,
          [req.user.user_id]
        );
        conversationId = rows[0].conversation_id;
      }

      // Notify whoever is connected first, then everyone else. Both get
      // told; the online ones are simply the ones who will see it now.
      const online = onlineUserIds();
      const { rows: psychologists } = await client.query(
        `SELECT p.user_id,
                (p.user_id = ANY($1::bigint[])) AS is_online
           FROM psychologist p
           JOIN "user" u ON u.user_id = p.user_id
          WHERE p.is_verified = true AND u.status = 'active'`,
        [online.length ? online : [0]]
      );

      await Promise.all(
        psychologists.map((c) =>
          notify(client, c.user_id,
            'A resident needs support now and is waiting in chat.',
            'message', '/psychologist/chat')
        )
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'support.connect', 'conversation', $2, $3)`,
        [req.user.user_id, conversationId,
         { online: psychologists.filter((c) => c.is_online).length, notified: psychologists.length }]
      );

      return {
        conversation_id: conversationId,
        already_claimed: alreadyClaimed,
        online_now: psychologists.filter((c) => c.is_online).length,
        notified: psychologists.length,
      };
    });

    if (!result.notified)
      throw ApiError.badRequest(
        'No verified psychologist is registered yet. Please use one of the hotline numbers.'
      );

    res.status(201).json(result);
  })
);

export default router;
