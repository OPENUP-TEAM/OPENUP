import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Module: Mood Tracking — 1. Log Mood
router.post('/', asyncHandler(async (req, res) => {
  const { mood_level, note, entry_date } = z.object({
    mood_level: z.coerce.number().int().min(1).max(5),
    note: z.string().max(500).optional(),
    entry_date: z.string().date().optional(),
  }).parse(req.body);

  // One entry per day: logging again replaces today's entry.
  const { rows } = await query(
    `INSERT INTO mood_entry (user_id, mood_level, note, entry_date)
     VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE))
     ON CONFLICT (user_id, entry_date)
     DO UPDATE SET mood_level = EXCLUDED.mood_level, note = EXCLUDED.note
     RETURNING *`,
    [req.user.user_id, mood_level, note ?? null, entry_date ?? null]
  );
  res.status(201).json({ entry: rows[0] });
}));

// Module: Mood Tracking — 2. View Mood History
router.get('/', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const { rows } = await query(
    `SELECT mood_id, mood_level, note, entry_date
       FROM mood_entry
      WHERE user_id = $1 AND entry_date >= CURRENT_DATE - $2::int
      ORDER BY entry_date`,
    [req.user.user_id, days]
  );
  res.json({ entries: rows });
}));

// Module: Mood Tracking — 3. View Mood Trends
router.get('/trends', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT date_trunc('week', entry_date)::date AS week,
            ROUND(AVG(mood_level), 2) AS avg_mood,
            COUNT(*) AS entries
       FROM mood_entry
      WHERE user_id = $1 AND entry_date >= CURRENT_DATE - 84
      GROUP BY week ORDER BY week`,
    [req.user.user_id]
  );
  res.json({ trends: rows });
}));

export default router;
