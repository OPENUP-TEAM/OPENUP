import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireVerifiedPsychologist } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// Module: Counseling Booking — 1. Book Session, 4. Apply Care Credits
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { psychologist_id, schedule, session_type, use_care_credit } = z
      .object({
        psychologist_id: z.coerce.number().int().positive(),
        schedule: z.string().datetime(),
        session_type: z.enum(['one_on_one', 'group']).default('one_on_one'),
        use_care_credit: z.boolean().default(false),
      })
      .parse(req.body);

    if (new Date(schedule) < new Date())
      throw ApiError.badRequest('Pick a time in the future.');

    const booking = await withTransaction(async (client) => {
      const psy = await client.query(
        `SELECT p.psychologist_id, p.rate_per_hour, p.user_id, u.name
           FROM psychologist p JOIN "user" u ON u.user_id = p.user_id
          WHERE p.psychologist_id = $1 AND p.is_verified = true
          FOR UPDATE OF p`,
        [psychologist_id]
      );
      if (!psy.rowCount) throw ApiError.notFound('That psychologist is not available.');

      const clash = await client.query(
        `SELECT 1 FROM booking
          WHERE psychologist_id = $1 AND schedule = $2
            AND status IN ('pending','confirmed')`,
        [psychologist_id, schedule]
      );
      if (clash.rowCount) throw ApiError.conflict('That slot was just taken. Choose another time.');

      // Reserve one care credit if the resident asked to use one.
      let creditId = null;
      if (use_care_credit) {
        const credit = await client.query(
          `SELECT credit_id FROM care_credit
            WHERE resident_id = $1 AND status = 'available'
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY issued_at
            LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [req.user.user_id]
        );
        if (!credit.rowCount)
          throw ApiError.badRequest('You have no Care Credits left for this period.');
        creditId = credit.rows[0].credit_id;
        await client.query(
          `UPDATE care_credit SET status = 'reserved' WHERE credit_id = $1`,
          [creditId]
        );
      }

      const { rows } = await client.query(
        `INSERT INTO booking (resident_id, psychologist_id, care_credit_id,
                              schedule, session_type, room_name)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.user_id, psychologist_id, creditId, schedule, session_type,
         `openup-${randomUUID().slice(0, 12)}`]
      );
      const created = rows[0];

      await client.query(
        `INSERT INTO payment (booking_id, amount, status, method)
         VALUES ($1,$2,$3,$4)`,
        [created.booking_id, psy.rows[0].rate_per_hour,
         creditId ? 'paid' : 'pending', creditId ? 'care_credit' : null]
      );

      await notify(client, psy.rows[0].user_id,
        'You have a new session request.', 'session', '/psychologist/requests');

      return created;
    });

    res.status(201).json({ booking });
  })
);

// Module: Counseling Booking — 2. View Scheduled Sessions
// Same endpoint serves residents and psychologists; the role decides the filter.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status ?? null;
    const isPsy = req.user.role === 'psychologist';

    const { rows } = await query(
      `SELECT b.booking_id, b.schedule, b.status, b.session_type, b.duration_min,
              b.room_name, b.care_credit_id IS NOT NULL AS covered_by_credit,
              resident.name AS resident_name, resident.display_alias,
              counselor.name AS psychologist_name
         FROM booking b
         JOIN "user" resident      ON resident.user_id = b.resident_id
         JOIN psychologist p       ON p.psychologist_id = b.psychologist_id
         JOIN "user" counselor     ON counselor.user_id = p.user_id
        WHERE ($2::boolean IS TRUE AND p.user_id = $1
               OR $2::boolean IS FALSE AND b.resident_id = $1)
          AND ($3::text IS NULL OR b.status = $3)
        ORDER BY b.schedule DESC`,
      [req.user.user_id, isPsy, status]
    );
    res.json({ bookings: rows });
  })
);

// Module: Appointment Requests — 2. Accept / 3. Decline
router.patch(
  '/:id/status',
  requireVerifiedPsychologist,
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['confirmed', 'declined', 'completed', 'no_show']) })
      .parse(req.body);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE booking SET status = $3
          WHERE booking_id = $1 AND psychologist_id = $2
          RETURNING *`,
        [req.params.id, req.psychologist.psychologist_id, status]
      );
      if (!rows.length) throw ApiError.notFound('That booking is not yours.');
      const booking = rows[0];

      // Release or consume the reserved credit as the session resolves.
      if (booking.care_credit_id) {
        const creditStatus =
          status === 'declined' ? 'available' : status === 'completed' ? 'consumed' : 'reserved';
        await client.query('UPDATE care_credit SET status = $2 WHERE credit_id = $1', [
          booking.care_credit_id,
          creditStatus,
        ]);
      }

      const messages = {
        confirmed: 'Your counseling session was confirmed.',
        declined: 'Your session request was declined. You can book another time.',
        completed: 'Your session was marked complete.',
        no_show: 'Your session was marked as missed.',
      };
      await notify(client, booking.resident_id, messages[status], 'session', '/sessions');
      return booking;
    });

    res.json({ booking: updated });
  })
);

// Module: Counseling Booking — 3. Cancel / Reschedule (resident side)
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE booking SET status = 'cancelled'
          WHERE booking_id = $1 AND resident_id = $2
            AND status IN ('pending','confirmed')
          RETURNING *`,
        [req.params.id, req.user.user_id]
      );
      if (!rows.length) throw ApiError.notFound('That booking cannot be cancelled.');
      if (rows[0].care_credit_id)
        await client.query(
          `UPDATE care_credit SET status = 'available' WHERE credit_id = $1`,
          [rows[0].care_credit_id]
        );
      return rows[0];
    });
    res.json({ booking: updated });
  })
);

export default router;
