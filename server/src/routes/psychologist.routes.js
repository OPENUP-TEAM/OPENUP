import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Module: Counseling Booking — browse verified psychologists (Figure 33).
// Filters mirror the storyboard: session type, language, specialization.
router.get('/', asyncHandler(async (req, res) => {
  const { language, specialization, q } = req.query;
  const { rows } = await query(
    `SELECT p.psychologist_id, u.name, p.specialization, p.languages,
            p.rate_per_hour, p.bio
       FROM psychologist p
       JOIN "user" u ON u.user_id = p.user_id
      WHERE p.is_verified = true
        AND u.status = 'active'
        AND ($1::text IS NULL OR p.languages ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR p.specialization ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR u.name ILIKE '%' || $3 || '%')
      ORDER BY u.name`,
    [language ?? null, specialization ?? null, q ?? null]
  );
  res.json({ psychologists: rows });
}));

// Open slots for a given date, derived from the weekly availability rows
// minus anything already booked.
router.get('/:id/slots', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `WITH windows AS (
       SELECT start_time, end_time FROM availability
        WHERE psychologist_id = $1
          AND day_of_week = EXTRACT(DOW FROM $2::date)
          AND is_active
     ),
     slots AS (
       SELECT generate_series(
                $2::date + w.start_time,
                $2::date + w.end_time - INTERVAL '1 hour',
                INTERVAL '1 hour') AS slot
         FROM windows w
     )
     SELECT s.slot
       FROM slots s
      WHERE NOT EXISTS (
        SELECT 1 FROM booking b
         WHERE b.psychologist_id = $1
           AND b.schedule = s.slot
           AND b.status IN ('pending','confirmed'))
      ORDER BY s.slot`,
    [req.params.id, date]
  );
  res.json({ slots: rows.map((r) => r.slot) });
}));

export default router;
