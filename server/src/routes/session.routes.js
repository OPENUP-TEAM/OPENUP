import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import { raiseCrisisAlert, getHotlines } from '../services/crisis.service.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Counseling Session (Noe Tobes)
//   1. Join Audio Session
//   2. In-Session Messaging      (Jitsi's own chat, inside the room)
//   3. Take Session Notes
//   4. Escalate to Emergency Services
// ---------------------------------------------------------------------

// A room opens shortly before the slot and closes a while after, so a
// leaked room name is not a permanent back door into a counseling room.
const OPEN_BEFORE_MIN = 15;
const CLOSE_AFTER_MIN = 90;

/**
 * Load a booking and confirm the caller is one of its two participants.
 * Everything in this file goes through here.
 */
async function loadSession(bookingId, user) {
  const { rows } = await query(
    `SELECT b.booking_id, b.schedule, b.status, b.session_type, b.duration_min,
            b.room_name, b.resident_id, b.psychologist_id,
            resident.name        AS resident_name,
            resident.display_alias,
            psychologist.name       AS psychologist_name,
            p.user_id            AS psychologist_user_id
       FROM booking b
       JOIN "user" resident  ON resident.user_id = b.resident_id
       JOIN psychologist p   ON p.psychologist_id = b.psychologist_id
       JOIN "user" psychologist ON psychologist.user_id = p.user_id
      WHERE b.booking_id = $1`,
    [bookingId]
  );

  const s = rows[0];
  if (!s) throw ApiError.notFound('No such session.');

  const isResident = s.resident_id === user.user_id;
  const isPsychologist = s.psychologist_user_id === user.user_id;
  if (!isResident && !isPsychologist)
    throw ApiError.forbidden('This session is not yours.');

  return { ...s, isResident, isPsychologist };
}

/** Minutes from now until the slot; negative once it has started. */
const minutesUntil = (schedule) => (new Date(schedule) - Date.now()) / 60000;

/** 1. Join Audio Session — room details, gated by status and time. */
router.get(
  '/:bookingId',
  asyncHandler(async (req, res) => {
    const s = await loadSession(req.params.bookingId, req.user);

    if (s.status !== 'confirmed') {
      const why = {
        pending: 'This session has not been confirmed yet.',
        declined: 'This session was declined.',
        cancelled: 'This session was cancelled.',
        completed: 'This session has already finished.',
        no_show: 'This session was marked as missed.',
      };
      throw ApiError.badRequest(why[s.status] ?? 'This session cannot be joined.');
    }

    const until = minutesUntil(s.schedule);
    const opensIn = Math.ceil(until - OPEN_BEFORE_MIN);

    if (until > OPEN_BEFORE_MIN)
      throw ApiError.badRequest(
        `The room opens ${OPEN_BEFORE_MIN} minutes before your session. Come back in ${opensIn} minute${opensIn === 1 ? '' : 's'}.`
      );

    if (until < -CLOSE_AFTER_MIN)
      throw ApiError.badRequest('This session has ended.');

    // The psychologist sees the alias, not the legal name, unless the resident
    // has chosen to share it. Consistent with how bookings are displayed.
    const residentLabel = s.display_alias || s.resident_name;

    res.json({
      booking_id: s.booking_id,
      room_name: s.room_name,
      domain: process.env.JITSI_DOMAIN || 'meet.jit.si',
      schedule: s.schedule,
      duration_min: s.duration_min,
      session_type: s.session_type,
      role: s.isPsychologist ? 'psychologist' : 'resident',
      // What each side is shown inside the call.
      display_name: s.isPsychologist ? s.psychologist_name : residentLabel,
      other_party: s.isPsychologist ? residentLabel : s.psychologist_name,
      minutes_until: Math.round(until),
    });
  })
);

/** 3. Take Session Notes — psychologist only. */
router.get(
  '/:bookingId/notes',
  asyncHandler(async (req, res) => {
    const s = await loadSession(req.params.bookingId, req.user);
    // Clinical notes are the psychologist's record. A resident reading unfiltered
    // notes mid-session would change what gets written, and what gets written
    // is what makes the notes useful.
    if (!s.isPsychologist) throw ApiError.forbidden('Only the psychologist can see session notes.');

    const { rows } = await query(
      `SELECT note_id, content, created_at
         FROM session_note
        WHERE booking_id = $1
        ORDER BY created_at`,
      [req.params.bookingId]
    );
    res.json({ notes: rows });
  })
);

router.post(
  '/:bookingId/notes',
  asyncHandler(async (req, res) => {
    const { content } = z
      .object({ content: z.string().trim().min(1, 'The note is empty.').max(5000) })
      .parse(req.body);

    const s = await loadSession(req.params.bookingId, req.user);
    if (!s.isPsychologist) throw ApiError.forbidden('Only the psychologist can write session notes.');

    const { rows } = await query(
      `INSERT INTO session_note (booking_id, psychologist_id, content)
       VALUES ($1, $2, $3)
       RETURNING note_id, content, created_at`,
      [s.booking_id, s.psychologist_id, content]
    );
    res.status(201).json({ note: rows[0] });
  })
);

/**
 * 4. Escalate to Emergency Services — psychologist only.
 *
 * Raises a crisis alert against the resident and returns hotline numbers
 * to the psychologist immediately. The psychologist is on a call with someone in
 * danger; they need numbers on screen, not a notification to read later.
 */
router.post(
  '/:bookingId/escalate',
  asyncHandler(async (req, res) => {
    const { severity, note } = z
      .object({
        severity: z.enum(['high', 'severe']).default('severe'),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);

    const s = await loadSession(req.params.bookingId, req.user);
    if (!s.isPsychologist)
      throw ApiError.forbidden('Only the psychologist can escalate a session.');

    const alert = await raiseCrisisAlert({
      userId: s.resident_id,
      source: 'session',
      sourceId: s.booking_id,
      riskLevel: severity,
    });

    // Link the alert to this booking and to the psychologist who raised it,
    // so the admin queue shows who is already involved.
    await query(
      `UPDATE crisis_alert
          SET booking_id = $2, handled_by = $3, status = 'assigned'
        WHERE alert_id = $1`,
      [alert.alert_id, s.booking_id, s.psychologist_id]
    );

    if (note) {
      await query(
        `INSERT INTO session_note (booking_id, psychologist_id, content)
         VALUES ($1, $2, $3)`,
        [s.booking_id, s.psychologist_id, `[Escalation] ${note}`]
      );
    }

    // Every admin should know a live session was escalated.
    const { rows: admins } = await query(
      `SELECT user_id FROM "user" WHERE role = 'admin' AND status = 'active'`
    );
    await Promise.all(
      admins.map((a) =>
        notify(
          null,
          a.user_id,
          'A psychologist escalated a live session to emergency support.',
          'system',
          '/admin/alerts'
        )
      )
    );

    res.status(201).json({
      alert_id: alert.alert_id,
      hotlines: alert.hotlines,
      contact_alerted: alert.contact_alerted,
    });
  })
);

/** Hotlines on their own, so the panel can open without escalating. */
router.get(
  '/:bookingId/hotlines',
  asyncHandler(async (req, res) => {
    await loadSession(req.params.bookingId, req.user);
    res.json({ hotlines: await getHotlines() });
  })
);

export default router;
