import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------
// Module: Appointment Management (Noe Tobes, admin)
//   1. View All Appointments
//   2. Reassign Appointment
//   3. Cancel Appointment
//
// Both write operations have to unwind money correctly. A reassignment
// moves a session without touching the resident's Care Credit; a
// cancellation has to give it back. Getting either wrong silently costs
// a resident a session their barangay paid for.
// ---------------------------------------------------------------------

/** 1. View All Appointments. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, barangay_id, from, to } = req.query;

    const { rows } = await query(
      `SELECT b.booking_id, b.schedule, b.status, b.session_type, b.duration_min,
              b.is_priority, b.created_at,
              b.care_credit_id IS NOT NULL AS covered_by_credit,
              resident.user_id       AS resident_id,
              resident.name          AS resident_name,
              resident.display_alias,
              bar.name               AS barangay_name,
              counselor.name         AS psychologist_name,
              p.psychologist_id,
              pay.amount, pay.status AS payment_status
         FROM booking b
         JOIN "user" resident   ON resident.user_id = b.resident_id
         JOIN barangay bar      ON bar.barangay_id = resident.barangay_id
         JOIN psychologist p    ON p.psychologist_id = b.psychologist_id
         JOIN "user" counselor  ON counselor.user_id = p.user_id
         LEFT JOIN payment pay  ON pay.booking_id = b.booking_id
        WHERE ($1::text   IS NULL OR b.status = $1)
          AND ($2::bigint IS NULL OR resident.barangay_id = $2)
          AND ($3::date   IS NULL OR b.schedule >= $3::date)
          AND ($4::date   IS NULL OR b.schedule < $4::date + 1)
        ORDER BY b.schedule DESC
        LIMIT 200`,
      [status || null, barangay_id || null, from || null, to || null]
    );

    const { rows: counts } = await query(
      `SELECT status, COUNT(*)::int AS n FROM booking GROUP BY status`
    );

    res.json({
      appointments: rows,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  })
);

/** Psychologists free at a given time, for the reassignment picker. */
router.get(
  '/:id/alternatives',
  asyncHandler(async (req, res) => {
    const { rows: b } = await query(
      'SELECT schedule, psychologist_id FROM booking WHERE booking_id = $1',
      [req.params.id]
    );
    if (!b.length) throw ApiError.notFound('No such appointment.');

    const { rows } = await query(
      `SELECT p.psychologist_id, u.name, p.specialization, p.languages, p.rate_per_hour
         FROM psychologist p
         JOIN "user" u ON u.user_id = p.user_id
        WHERE p.is_verified = true
          AND u.status = 'active'
          AND p.psychologist_id <> $2
          -- free at that moment
          AND NOT EXISTS (
            SELECT 1 FROM booking x
             WHERE x.psychologist_id = p.psychologist_id
               AND x.schedule = $1
               AND x.status IN ('pending','confirmed'))
          -- and actually works that day
          AND EXISTS (
            SELECT 1 FROM availability a
             WHERE a.psychologist_id = p.psychologist_id
               AND a.is_active
               AND a.day_of_week = EXTRACT(DOW FROM $1::timestamptz)
               AND $1::timestamptz::time >= a.start_time
               AND $1::timestamptz::time <  a.end_time)
        ORDER BY u.name`,
      [b[0].schedule, b[0].psychologist_id]
    );

    res.json({ schedule: b[0].schedule, psychologists: rows });
  })
);

/**
 * 2. Reassign Appointment.
 *
 * The Care Credit is deliberately left alone. The resident is getting the
 * session their barangay paid for, just with a different counselor, so
 * releasing and re-reserving would risk losing it for no reason.
 */
router.patch(
  '/:id/reassign',
  asyncHandler(async (req, res) => {
    const { psychologist_id, reason } = z
      .object({
        psychologist_id: z.coerce.number().int().positive(),
        reason: z.string().trim().min(5, 'Give a reason the resident can understand.').max(255),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT b.booking_id, b.schedule, b.status, b.resident_id, b.psychologist_id,
                old_p.user_id AS old_user_id
           FROM booking b
           JOIN psychologist old_p ON old_p.psychologist_id = b.psychologist_id
          WHERE b.booking_id = $1
          FOR UPDATE OF b`,
        [req.params.id]
      );
      const bk = rows[0];
      if (!bk) throw ApiError.notFound('No such appointment.');
      if (!['pending', 'confirmed'].includes(bk.status))
        throw ApiError.badRequest('Only pending or confirmed appointments can be reassigned.');
      if (bk.psychologist_id === psychologist_id)
        throw ApiError.badRequest('That is already the assigned counselor.');

      const { rows: target } = await client.query(
        `SELECT p.psychologist_id, p.user_id, u.name
           FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
          WHERE p.psychologist_id = $1 AND p.is_verified = true AND u.status = 'active'`,
        [psychologist_id]
      );
      if (!target.length) throw ApiError.badRequest('That counselor is not available.');

      const { rowCount: clash } = await client.query(
        `SELECT 1 FROM booking
          WHERE psychologist_id = $1 AND schedule = $2
            AND status IN ('pending','confirmed')`,
        [psychologist_id, bk.schedule]
      );
      if (clash) throw ApiError.conflict('That counselor is already booked at that time.');

      // Back to pending: the new counselor has not agreed to this yet.
      await client.query(
        `UPDATE booking SET psychologist_id = $2, status = 'pending'
          WHERE booking_id = $1`,
        [bk.booking_id, psychologist_id]
      );

      await notify(client, bk.resident_id,
        `Your session was moved to ${target[0].name}. ${reason}`,
        'session', '/app/sessions');
      await notify(client, target[0].user_id,
        'An administrator assigned a session request to you.',
        'session', '/psychologist/requests');
      await notify(client, bk.old_user_id,
        'A session was reassigned away from you by an administrator.',
        'session', '/psychologist/requests');

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'appointment.reassign', 'booking', $2, $3)`,
        [req.user.user_id, bk.booking_id,
         { from: bk.psychologist_id, to: psychologist_id, reason }]
      );

      return { booking_id: bk.booking_id, psychologist: target[0].name };
    });

    res.json({ ok: true, ...result });
  })
);

/** 3. Cancel Appointment. The Care Credit goes back to the resident. */
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(5).max(255) })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE booking SET status = 'cancelled'
          WHERE booking_id = $1 AND status IN ('pending','confirmed')
          RETURNING booking_id, resident_id, psychologist_id, care_credit_id`,
        [req.params.id]
      );
      const bk = rows[0];
      if (!bk) throw ApiError.badRequest('That appointment cannot be cancelled.');

      let creditReturned = false;
      if (bk.care_credit_id) {
        await client.query(
          `UPDATE care_credit SET status = 'available' WHERE credit_id = $1`,
          [bk.care_credit_id]
        );
        creditReturned = true;
      }

      await client.query(
        `UPDATE payment SET status = 'refunded'
          WHERE booking_id = $1 AND status = 'paid'`,
        [bk.booking_id]
      );

      const { rows: counselor } = await client.query(
        'SELECT user_id FROM psychologist WHERE psychologist_id = $1',
        [bk.psychologist_id]
      );

      await notify(client, bk.resident_id,
        `Your session was cancelled by an administrator. ${reason}` +
        (creditReturned ? ' Your Care Credit has been returned.' : ''),
        'session', '/app/sessions');
      if (counselor.length) {
        await notify(client, counselor[0].user_id,
          'An administrator cancelled one of your sessions.',
          'session', '/psychologist/requests');
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'appointment.cancel', 'booking', $2, $3)`,
        [req.user.user_id, bk.booking_id, { reason, credit_returned: creditReturned }]
      );

      return { credit_returned: creditReturned };
    });

    res.json({ ok: true, ...result });
  })
);

export default router;
