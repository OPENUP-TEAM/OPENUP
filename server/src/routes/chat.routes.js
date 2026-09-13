import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Anonymous Chat (Noe Tobes)
//   1. Send Message          (Socket.IO, see sockets/index.js)
//   2. Receive Message       (Socket.IO)
//   3. Toggle Anonymous Mode
//
// This file covers everything the sockets cannot: starting a conversation,
// listing them, loading history, and claiming an unassigned one.
// ---------------------------------------------------------------------

/** Confirms the caller belongs to this conversation, and says which side. */
async function loadConversation(conversationId, user) {
  const { rows } = await query(
    `SELECT c.conversation_id, c.resident_id, c.psychologist_id,
            c.is_anonymous, c.status, c.created_at,
            resident.name          AS resident_name,
            resident.display_alias,
            counselor.name         AS psychologist_name,
            p.user_id              AS psychologist_user_id
       FROM conversation c
       JOIN "user" resident        ON resident.user_id = c.resident_id
       LEFT JOIN psychologist p    ON p.psychologist_id = c.psychologist_id
       LEFT JOIN "user" counselor  ON counselor.user_id = p.user_id
      WHERE c.conversation_id = $1`,
    [conversationId]
  );

  const c = rows[0];
  if (!c) throw ApiError.notFound('No such conversation.');

  const isResident = c.resident_id === user.user_id;
  const isCounselor = c.psychologist_user_id === user.user_id;
  if (!isResident && !isCounselor)
    throw ApiError.forbidden('This conversation is not yours.');

  return { ...c, isResident, isCounselor };
}

/**
 * How a resident is labelled to the other side.
 * While anonymous, their real name never leaves the server.
 */
const residentLabel = (c) =>
  c.is_anonymous ? c.display_alias || 'Anonymous resident' : c.resident_name;

/**
 * Start a conversation.
 *
 * psychologist_id is optional on purpose. A resident who is not ready to
 * choose a counselor can open a conversation with nobody attached, and it
 * lands in a queue any verified psychologist can pick up. Forcing a choice
 * first is exactly the friction this module exists to remove.
 */
router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'resident')
      throw ApiError.forbidden('Only residents can start a conversation.');

    const { psychologist_id, is_anonymous } = z
      .object({
        psychologist_id: z.coerce.number().int().positive().optional(),
        is_anonymous: z.boolean().default(true),
      })
      .parse(req.body);

    const conversation = await withTransaction(async (client) => {
      if (psychologist_id) {
        const ok = await client.query(
          `SELECT p.user_id FROM psychologist p
             JOIN "user" u ON u.user_id = p.user_id
            WHERE p.psychologist_id = $1 AND p.is_verified = true AND u.status = 'active'`,
          [psychologist_id]
        );
        if (!ok.rowCount) throw ApiError.notFound('That counselor is not available.');
      }

      // One open conversation per pairing, so a resident does not end up
      // with a list of half-finished threads.
      const existing = await client.query(
        `SELECT conversation_id FROM conversation
          WHERE resident_id = $1 AND status = 'open'
            AND (psychologist_id IS NOT DISTINCT FROM $2)`,
        [req.user.user_id, psychologist_id ?? null]
      );
      if (existing.rowCount)
        return { conversation_id: existing.rows[0].conversation_id, reused: true };

      const { rows } = await client.query(
        `INSERT INTO conversation (resident_id, psychologist_id, is_anonymous)
         VALUES ($1, $2, $3)
         RETURNING conversation_id`,
        [req.user.user_id, psychologist_id ?? null, is_anonymous]
      );

      if (psychologist_id) {
        const { rows: u } = await client.query(
          'SELECT user_id FROM psychologist WHERE psychologist_id = $1',
          [psychologist_id]
        );
        await notify(client, u[0].user_id, 'A resident started a chat with you.',
          'message', '/psychologist/chat');
      }

      return { conversation_id: rows[0].conversation_id, reused: false };
    });

    res.status(conversation.reused ? 200 : 201).json(conversation);
  })
);

/**
 * List conversations.
 *
 * A resident sees their own. A verified psychologist sees the ones
 * assigned to them, plus the unclaimed queue.
 */
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const isResident = req.user.role === 'resident';

    const { rows } = await query(
      `SELECT c.conversation_id, c.is_anonymous, c.status, c.created_at,
              c.psychologist_id,
              resident.name          AS resident_name,
              resident.display_alias,
              counselor.name         AS psychologist_name,
              last.content           AS last_message,
              last.sent_at           AS last_sent_at,
              COALESCE(unread.n, 0)::int AS unread
         FROM conversation c
         JOIN "user" resident       ON resident.user_id = c.resident_id
         LEFT JOIN psychologist p   ON p.psychologist_id = c.psychologist_id
         LEFT JOIN "user" counselor ON counselor.user_id = p.user_id
         LEFT JOIN LATERAL (
           SELECT content, sent_at FROM message m
            WHERE m.conversation_id = c.conversation_id
            ORDER BY sent_at DESC LIMIT 1
         ) last ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS n FROM message m
            WHERE m.conversation_id = c.conversation_id
              AND m.sender_id <> $1 AND m.is_read = false
         ) unread ON true
        WHERE CASE WHEN $2::boolean
                   THEN c.resident_id = $1
                   ELSE p.user_id = $1
                        OR (c.psychologist_id IS NULL AND c.status = 'open')
              END
        ORDER BY COALESCE(last.sent_at, c.created_at) DESC`,
      [req.user.user_id, isResident]
    );

    const conversations = rows.map((c) => ({
      conversation_id: c.conversation_id,
      status: c.status,
      is_anonymous: c.is_anonymous,
      unread: c.unread,
      last_message: c.last_message,
      last_sent_at: c.last_sent_at,
      created_at: c.created_at,
      unclaimed: c.psychologist_id === null,
      // Each side sees the other, never themselves.
      title: isResident
        ? c.psychologist_name || 'Waiting for a counselor'
        : residentLabel(c),
    }));

    res.json({ conversations });
  })
);

/**
 * Claim an unassigned conversation.
 *
 * Locked and re-checked inside the transaction: two counselors opening the
 * queue at the same moment must not both end up in the same thread.
 */
router.patch(
  '/conversations/:id/claim',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'psychologist')
      throw ApiError.forbidden('Only counselors can claim a conversation.');

    const claimed = await withTransaction(async (client) => {
      const { rows: me } = await client.query(
        `SELECT psychologist_id, is_verified FROM psychologist WHERE user_id = $1`,
        [req.user.user_id]
      );
      if (!me.length) throw ApiError.forbidden('No psychologist profile on this account.');
      if (!me[0].is_verified)
        throw ApiError.forbidden('Your license is still being reviewed.');

      const { rows } = await client.query(
        `SELECT conversation_id, psychologist_id, resident_id
           FROM conversation WHERE conversation_id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const c = rows[0];
      if (!c) throw ApiError.notFound('No such conversation.');
      if (c.psychologist_id)
        throw ApiError.conflict('Another counselor has already picked this one up.');

      await client.query(
        `UPDATE conversation SET psychologist_id = $2 WHERE conversation_id = $1`,
        [c.conversation_id, me[0].psychologist_id]
      );

      await notify(client, c.resident_id,
        'A counselor has joined your chat.', 'message', '/app/chat');

      return c;
    });

    res.json({ ok: true, conversation_id: claimed.conversation_id });
  })
);

/** History, plus who the other side is. */
router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const c = await loadConversation(req.params.id, req.user);

    const { rows } = await query(
      `SELECT m.message_id, m.sender_id, m.content, m.sent_at, m.is_read,
              u.role AS sender_role
         FROM message m
         JOIN "user" u ON u.user_id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.sent_at`,
      [req.params.id]
    );

    // Mark the other side's messages read now they are on screen.
    await query(
      `UPDATE message SET is_read = true
        WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = false`,
      [req.params.id, req.user.user_id]
    );

    res.json({
      conversation: {
        conversation_id: c.conversation_id,
        is_anonymous: c.is_anonymous,
        status: c.status,
        role: c.isResident ? 'resident' : 'psychologist',
        other_party: c.isResident
          ? c.psychologist_name || 'Waiting for a counselor'
          : residentLabel(c),
      },
      messages: rows.map((m) => ({
        ...m,
        mine: m.sender_id === req.user.user_id,
        sender_name:
          m.sender_role === 'resident' ? residentLabel(c) : c.psychologist_name,
      })),
    });
  })
);

/**
 * 3. Toggle Anonymous Mode — resident only.
 *
 * One-way by design. Turning anonymity off reveals a real name to someone
 * who has already read the conversation; turning it back on afterwards
 * would only hide it from the interface, not from the person. Saying so
 * plainly beats offering a switch that does not really undo anything.
 */
router.patch(
  '/conversations/:id/anonymity',
  asyncHandler(async (req, res) => {
    const { is_anonymous } = z.object({ is_anonymous: z.boolean() }).parse(req.body);

    const c = await loadConversation(req.params.id, req.user);
    if (!c.isResident)
      throw ApiError.forbidden('Only the resident can change this.');

    if (is_anonymous && !c.is_anonymous)
      throw ApiError.badRequest(
        'Your counselor has already seen your name in this conversation, so it cannot be hidden again. Start a new chat if you want to stay anonymous.'
      );

    await query(
      'UPDATE conversation SET is_anonymous = $2 WHERE conversation_id = $1',
      [c.conversation_id, is_anonymous]
    );

    if (!is_anonymous && c.psychologist_user_id) {
      await notify(null, c.psychologist_user_id,
        'A resident chose to share their name with you.', 'message', '/psychologist/chat');
    }

    res.json({ ok: true, is_anonymous });
  })
);

router.patch(
  '/conversations/:id/close',
  asyncHandler(async (req, res) => {
    const c = await loadConversation(req.params.id, req.user);
    await query(
      `UPDATE conversation SET status = 'closed' WHERE conversation_id = $1`,
      [c.conversation_id]
    );
    res.json({ ok: true });
  })
);

export default router;
