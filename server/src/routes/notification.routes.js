import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM notification WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [req.user.user_id]
  );
  res.json({
    notifications: rows,
    unread: rows.filter((n) => !n.is_read).length,
  });
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  await query(
    'UPDATE notification SET is_read = true WHERE notification_id = $1 AND user_id = $2',
    [req.params.id, req.user.user_id]
  );
  res.json({ ok: true });
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  await query('UPDATE notification SET is_read = true WHERE user_id = $1', [req.user.user_id]);
  res.json({ ok: true });
}));

export default router;
