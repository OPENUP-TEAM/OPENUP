import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { respond } from '../services/ai-companion.service.js';
import { raiseCrisisAlert, shouldEscalate, getHotlines } from '../services/crisis.service.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('resident'));

// ---------------------------------------------------------------------
// Module: AI Crisis Companion (Noe Tobes)
//   1. Start Chat
//   2. Crisis Detection
//   3. Escalate to Licensed Psychologist
//   4. Alert Trusted Person
// ---------------------------------------------------------------------

/** Confirms the conversation belongs to the caller. */
async function loadConversation(id, userId) {
  const { rows } = await query(
    `SELECT ai_conversation_id, user_id, language, started_at, ended_at,
            helpfulness_rating
       FROM ai_conversation WHERE ai_conversation_id = $1`,
    [id]
  );
  const c = rows[0];
  if (!c) throw ApiError.notFound('No such conversation.');
  if (c.user_id !== userId) throw ApiError.forbidden('This conversation is not yours.');
  return c;
}

/** Hotlines, always reachable without having to say anything first. */
router.get(
  '/support',
  asyncHandler(async (_req, res) => res.json({ hotlines: await getHotlines() }))
);

/** 1. Start Chat. */
router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const { language } = z
      .object({ language: z.enum(['en', 'tl', 'ceb']).default('en') })
      .parse(req.body);

    const { rows } = await query(
      `INSERT INTO ai_conversation (user_id, language)
       VALUES ($1, $2) RETURNING ai_conversation_id, language, started_at`,
      [req.user.user_id, language]
    );

    const opening = {
      en: 'I am here. Whatever is going on, you can say it however it comes out.',
      tl: 'Nandito ako. Anuman ang nangyayari, sabihin mo lang kung paano mo kaya.',
      ceb: 'Ania ra ko. Bisan unsa pay nahitabo, isulti lang sa imong paagi.',
    };

    await query(
      `INSERT INTO ai_message (ai_conversation_id, role, content)
       VALUES ($1, 'assistant', $2)`,
      [rows[0].ai_conversation_id, opening[language]]
    );

    res.status(201).json({
      conversation: rows[0],
      opening: opening[language],
    });
  })
);

/** Conversation history. */
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.ai_conversation_id, c.language, c.started_at, c.ended_at,
              c.helpfulness_rating,
              (SELECT COUNT(*)::int FROM ai_message m
                WHERE m.ai_conversation_id = c.ai_conversation_id) AS message_count,
              (SELECT content FROM ai_message m
                WHERE m.ai_conversation_id = c.ai_conversation_id AND m.role = 'user'
                ORDER BY sent_at DESC LIMIT 1) AS last_said
         FROM ai_conversation c
        WHERE c.user_id = $1
        ORDER BY c.started_at DESC
        LIMIT 30`,
      [req.user.user_id]
    );
    res.json({ conversations: rows });
  })
);

router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const c = await loadConversation(req.params.id, req.user.user_id);
    const { rows } = await query(
      `SELECT ai_message_id, role, content, risk_score, sent_at
         FROM ai_message WHERE ai_conversation_id = $1 ORDER BY sent_at`,
      [req.params.id]
    );
    res.json({ conversation: c, messages: rows });
  })
);

/** 2. Crisis Detection happens on every message sent. */
router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const { content } = z
      .object({ content: z.string().trim().min(1).max(4000) })
      .parse(req.body);

    const c = await loadConversation(req.params.id, req.user.user_id);
    if (c.ended_at) throw ApiError.badRequest('This conversation has ended. Start a new one.');

    const { rows: history } = await query(
      `SELECT role, content FROM ai_message
        WHERE ai_conversation_id = $1 ORDER BY sent_at`,
      [c.ai_conversation_id]
    );

    const result = await respond(history, content, c.language);

    // Store both sides in one transaction so a failure never leaves a
    // reply without the message that prompted it.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO ai_message (ai_conversation_id, role, content, risk_score)
         VALUES ($1, 'user', $2, $3)`,
        [c.ai_conversation_id, content, result.risk_score]
      );
      await client.query(
        `INSERT INTO ai_message (ai_conversation_id, role, content, response_ms)
         VALUES ($1, 'assistant', $2, $3)`,
        [c.ai_conversation_id, result.reply, result.response_ms]
      );
    });

    // Escalate once per conversation, not on every subsequent message.
    let crisis = null;
    if (await shouldEscalate(result)) {
      const { rows: existing } = await query(
        `SELECT alert_id FROM crisis_alert
          WHERE user_id = $1 AND source = 'ai_companion'
            AND source_id = $2 AND status <> 'resolved'`,
        [req.user.user_id, c.ai_conversation_id]
      );

      if (existing.length) {
        crisis = { alert_id: existing[0].alert_id, hotlines: await getHotlines(), repeat: true };
      } else {
        crisis = await raiseCrisisAlert({
          userId: req.user.user_id,
          source: 'ai_companion',
          sourceId: c.ai_conversation_id,
          riskLevel: result.risk_level,
        });
      }
    }

    res.status(201).json({
      reply: result.reply,
      risk_level: result.risk_level,
      crisis: crisis
        ? {
            hotlines: crisis.hotlines,
            contact_alerted: crisis.contact_alerted ?? false,
            message:
              'I am glad you told me. I am not a person, though, and you deserve one right now.',
          }
        : null,
      mocked: result.mocked,
    });
  })
);

/**
 * 3. Escalate to Licensed Psychologist.
 *
 * Opens a real chat with a human, carried into the counselor queue. The
 * AI conversation is not copied across: what someone told a machine at
 * 3am is theirs to repeat or not.
 */
router.post(
  '/conversations/:id/escalate',
  asyncHandler(async (req, res) => {
    const c = await loadConversation(req.params.id, req.user.user_id);

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT conversation_id FROM conversation
          WHERE resident_id = $1 AND psychologist_id IS NULL AND status = 'open'`,
        [req.user.user_id]
      );

      let conversationId;
      if (existing.rowCount) {
        conversationId = existing.rows[0].conversation_id;
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

      const { rows: onDuty } = await client.query(
        `SELECT p.user_id FROM psychologist p
           JOIN "user" u ON u.user_id = p.user_id
          WHERE p.is_verified = true AND u.status = 'active'`
      );
      await Promise.all(
        onDuty.map((p) =>
          notify(client, p.user_id,
            'A resident asked to speak with a counselor after using the crisis companion.',
            'message', '/psychologist/chat')
        )
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'companion.escalate', 'ai_conversation', $2, $3)`,
        [req.user.user_id, c.ai_conversation_id, { conversation_id: conversationId }]
      );

      return { conversationId, notified: onDuty.length };
    });

    res.status(201).json({
      conversation_id: result.conversationId,
      counselors_notified: result.notified,
      hotlines: await getHotlines(),
    });
  })
);

/** Rating feeds the AI Effectiveness Tracker. */
router.patch(
  '/conversations/:id/rate',
  asyncHandler(async (req, res) => {
    const { rating } = z
      .object({ rating: z.coerce.number().int().min(1).max(5) })
      .parse(req.body);

    await loadConversation(req.params.id, req.user.user_id);
    await query(
      `UPDATE ai_conversation
          SET helpfulness_rating = $2, ended_at = COALESCE(ended_at, now())
        WHERE ai_conversation_id = $1`,
      [req.params.id, rating]
    );
    res.json({ ok: true });
  })
);

router.patch(
  '/conversations/:id/end',
  asyncHandler(async (req, res) => {
    await loadConversation(req.params.id, req.user.user_id);
    await query(
      `UPDATE ai_conversation SET ended_at = now() WHERE ai_conversation_id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------
// 4. Alert Trusted Person — managing who that person is.
// ---------------------------------------------------------------------

router.get(
  '/trusted-contacts',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT contact_id, name, phone, email, relationship
         FROM trusted_contact WHERE user_id = $1 ORDER BY contact_id`,
      [req.user.user_id]
    );
    res.json({ contacts: rows });
  })
);

router.post(
  '/trusted-contacts',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().max(30).optional(),
        email: z.string().email().max(100).optional().or(z.literal('')),
        relationship: z.string().trim().max(50).optional(),
      })
      .parse(req.body);

    if (!data.phone && !data.email)
      throw ApiError.badRequest('Add a phone number or an email so they can be reached.');

    const { rows } = await query(
      `INSERT INTO trusted_contact (user_id, name, phone, email, relationship)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING contact_id, name, phone, email, relationship`,
      [req.user.user_id, data.name, data.phone || null, data.email || null,
       data.relationship || null]
    );
    res.status(201).json({ contact: rows[0] });
  })
);

router.delete(
  '/trusted-contacts/:id',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'DELETE FROM trusted_contact WHERE contact_id = $1 AND user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (!rowCount) throw ApiError.notFound('No such contact.');
    res.json({ ok: true });
  })
);

export default router;
