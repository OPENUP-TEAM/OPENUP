import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireVerifiedPsychologist } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Group Counseling (Noe Tobes)
//   1. View Group Sessions
//   2. Join Session
//   3. Facilitate Session
// ---------------------------------------------------------------------

const OPEN_BEFORE_MIN = 15;
const CLOSE_AFTER_MIN = 120;
const minutesUntil = (schedule) => (new Date(schedule) - Date.now()) / 60000;

/** 1. View Group Sessions. Both roles use this; the role changes the filter. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const mine = req.query.mine === 'true';
    const isPsychologist = req.user.role === 'psychologist';

    const { rows } = await query(
      `SELECT g.group_session_id, g.title, g.topic, g.schedule, g.capacity,
              g.status, g.room_name, g.psychologist_id,
              u.name AS facilitator_name,
              p.user_id AS facilitator_user_id,
              COUNT(gp.user_id)::int AS joined,
              BOOL_OR(gp.user_id = $1) AS i_joined
         FROM group_session g
         JOIN psychologist p ON p.psychologist_id = g.psychologist_id
         JOIN "user" u       ON u.user_id = p.user_id
         LEFT JOIN group_participant gp ON gp.group_session_id = g.group_session_id
        WHERE g.status <> 'cancelled'
          AND ($2::boolean IS FALSE OR (
                CASE WHEN $3::boolean THEN p.user_id = $1
                     ELSE EXISTS (SELECT 1 FROM group_participant x
                                   WHERE x.group_session_id = g.group_session_id
                                     AND x.user_id = $1)
                END))
        GROUP BY g.group_session_id, u.name, p.user_id
        ORDER BY g.schedule`,
      [req.user.user_id, mine, isPsychologist]
    );

    res.json({
      sessions: rows.map((g) => ({
        ...g,
        i_joined: Boolean(g.i_joined),
        seats_left: Math.max(0, g.capacity - g.joined),
        is_facilitator: g.facilitator_user_id === req.user.user_id,
        // Past sessions stay visible but are not joinable.
        joinable: new Date(g.schedule) > new Date(Date.now() - CLOSE_AFTER_MIN * 60000),
      })),
    });
  })
);

/** 3. Facilitate Session — create one. */
router.post(
  '/',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const { title, topic, schedule, capacity } = z
      .object({
        title: z.string().trim().min(3).max(120),
        topic: z.string().trim().max(100).optional(),
        schedule: z.string().datetime(),
        capacity: z.coerce.number().int().min(2).max(30).default(10),
      })
      .parse(req.body);

    if (new Date(schedule) < new Date())
      throw ApiError.badRequest('Pick a time in the future.');

    // A facilitator cannot be in two rooms at once, so a group session must
    // not overlap an existing one-on-one booking.
    const clash = await query(
      `SELECT 1 FROM booking
        WHERE psychologist_id = $1 AND schedule = $2
          AND status IN ('pending','confirmed')`,
      [req.psychologist.psychologist_id, schedule]
    );
    if (clash.rowCount)
      throw ApiError.conflict('You already have a one-on-one session at that time.');

    const { rows } = await query(
      `INSERT INTO group_session
         (psychologist_id, title, topic, schedule, capacity, room_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
       RETURNING *`,
      [req.psychologist.psychologist_id, title, topic ?? null, schedule, capacity,
       `openup-grp-${randomUUID().slice(0, 10)}`]
    );

    res.status(201).json({ session: rows[0] });
  })
);

/**
 * 2. Join Session.
 *
 * Capacity is enforced inside a transaction with the session row locked.
 * Counting seats outside a lock lets two residents both read "1 seat left"
 * and both take it, which is the whole failure this module has to avoid.
 */
router.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'resident')
      throw ApiError.forbidden('Only residents can join a group session.');

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT g.group_session_id, g.title, g.capacity, g.schedule, g.status,
                p.user_id AS facilitator_user_id
           FROM group_session g
           JOIN psychologist p ON p.psychologist_id = g.psychologist_id
          WHERE g.group_session_id = $1
          FOR UPDATE OF g`,
        [req.params.id]
      );
      const g = rows[0];
      if (!g) throw ApiError.notFound('No such group session.');
      if (g.status === 'cancelled') throw ApiError.badRequest('That session was cancelled.');
      if (g.status === 'completed') throw ApiError.badRequest('That session has finished.');
      if (new Date(g.schedule) < new Date())
        throw ApiError.badRequest('That session has already started.');

      const { rows: c } = await client.query(
        'SELECT COUNT(*)::int AS n FROM group_participant WHERE group_session_id = $1',
        [g.group_session_id]
      );
      if (c[0].n >= g.capacity)
        throw ApiError.conflict('That session is full. Try another one.');

      // The primary key already prevents double-joining; ON CONFLICT turns
      // an accidental second tap into a no-op rather than an error.
      const { rowCount } = await client.query(
        `INSERT INTO group_participant (group_session_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [g.group_session_id, req.user.user_id]
      );

      if (rowCount) {
        await notify(client, g.facilitator_user_id,
          `Someone joined your group session "${g.title}".`,
          'session', '/psychologist/groups');
      }

      return { joined: Boolean(rowCount), seats_left: g.capacity - c[0].n - (rowCount ? 1 : 0) };
    });

    res.status(201).json(result);
  })
);

router.delete(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      'DELETE FROM group_participant WHERE group_session_id = $1 AND user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (!rowCount) throw ApiError.notFound('You are not in that session.');
    res.json({ ok: true });
  })
);

/** Cancel, facilitator only. Participants are told. */
router.patch(
  '/:id/cancel',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const cancelled = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE group_session SET status = 'cancelled'
          WHERE group_session_id = $1 AND psychologist_id = $2
          RETURNING group_session_id, title`,
        [req.params.id, req.psychologist.psychologist_id]
      );
      if (!rows.length) throw ApiError.notFound('That session is not yours.');

      const { rows: people } = await client.query(
        'SELECT user_id FROM group_participant WHERE group_session_id = $1',
        [rows[0].group_session_id]
      );
      await Promise.all(
        people.map((p) =>
          notify(client, p.user_id,
            `The group session "${rows[0].title}" was cancelled.`,
            'session', '/app/groups')
        )
      );

      return rows[0];
    });

    res.json({ ok: true, group_session_id: cancelled.group_session_id });
  })
);

/**
 * Room details, gated the same way one-on-one sessions are.
 * Participants see each other's aliases, never real names.
 */
router.get(
  '/:id/room',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT g.group_session_id, g.title, g.schedule, g.status, g.room_name,
              u.name AS facilitator_name, p.user_id AS facilitator_user_id,
              me.display_alias, me.name AS my_name
         FROM group_session g
         JOIN psychologist p ON p.psychologist_id = g.psychologist_id
         JOIN "user" u       ON u.user_id = p.user_id
         CROSS JOIN LATERAL (
           SELECT display_alias, name FROM "user" WHERE user_id = $2
         ) me
        WHERE g.group_session_id = $1`,
      [req.params.id, req.user.user_id]
    );
    const g = rows[0];
    if (!g) throw ApiError.notFound('No such group session.');

    const isFacilitator = g.facilitator_user_id === req.user.user_id;

    if (!isFacilitator) {
      const { rowCount } = await query(
        'SELECT 1 FROM group_participant WHERE group_session_id = $1 AND user_id = $2',
        [req.params.id, req.user.user_id]
      );
      if (!rowCount) throw ApiError.forbidden('Join this session before opening the room.');
    }

    if (g.status === 'cancelled') throw ApiError.badRequest('That session was cancelled.');

    const until = minutesUntil(g.schedule);
    if (until > OPEN_BEFORE_MIN) {
      const opensIn = Math.ceil(until - OPEN_BEFORE_MIN);
      throw ApiError.badRequest(
        `The room opens ${OPEN_BEFORE_MIN} minutes before the session. Come back in ${opensIn} minute${opensIn === 1 ? '' : 's'}.`
      );
    }
    if (until < -CLOSE_AFTER_MIN) throw ApiError.badRequest('That session has ended.');

    res.json({
      booking_id: g.group_session_id,
      room_name: g.room_name,
      domain: process.env.JITSI_DOMAIN || 'meet.jit.si',
      schedule: g.schedule,
      duration_min: 60,
      session_type: 'group',
      role: isFacilitator ? 'psychologist' : 'resident',
      // Everyone in a group room is an alias unless they are the facilitator.
      display_name: isFacilitator
        ? g.facilitator_name
        : g.display_alias || 'Anonymous resident',
      other_party: g.title,
      minutes_until: Math.round(until),
    });
  })
);

export default router;
