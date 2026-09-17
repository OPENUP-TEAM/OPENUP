import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Counts for the sidebar badges.
 *
 * One request rather than each page fetching its own, because the sidebar
 * is always on screen and a badge per page would mean a request per page
 * per navigation.
 *
 * Only things that need a person to act are counted. A badge that never
 * clears teaches people to ignore badges, so this deliberately excludes
 * anything informational — total sessions, total residents, anything a
 * number would merely describe rather than ask for.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, user_id, barangay_id } = req.user;

    const unread = await query(
      `SELECT COUNT(*)::int AS n FROM notification
        WHERE user_id = $1 AND is_read = false`,
      [user_id]
    );

    const counts = { notifications: unread.rows[0].n };

    if (role === 'psychologist') {
      const { rows } = await query(
        `SELECT
           -- Unresolved crisis alerts are the one thing on this screen that
           -- may not wait, so they are counted for every psychologist, not
           -- only the one who claimed them.
           (SELECT COUNT(*)::int FROM crisis_alert
             WHERE status <> 'resolved')                                  AS alerts,
           (SELECT COUNT(*)::int FROM booking bk
              JOIN psychologist p ON p.psychologist_id = bk.psychologist_id
             WHERE p.user_id = $1 AND bk.status = 'pending'
               AND bk.schedule > now())                                   AS requests,
           -- Unread messages, plus conversations nobody has picked up.
           (SELECT COUNT(DISTINCT m.conversation_id)::int
              FROM message m
              JOIN conversation c ON c.conversation_id = m.conversation_id
              JOIN psychologist p ON p.psychologist_id = c.psychologist_id
             WHERE p.user_id = $1 AND m.sender_id <> $1 AND m.is_read = false)
           + (SELECT COUNT(*)::int FROM conversation
               WHERE psychologist_id IS NULL AND status IN ('open','escalated')) AS chat`,
        [user_id]
      );
      Object.assign(counts, rows[0]);
    }

    if (role === 'resident') {
      const { rows } = await query(
        `SELECT
           (SELECT COUNT(DISTINCT m.conversation_id)::int
              FROM message m
              JOIN conversation c ON c.conversation_id = m.conversation_id
             WHERE c.resident_id = $1 AND m.sender_id <> $1
               AND m.is_read = false)                                     AS chat,
           -- Confirmed sessions starting within the hour, so the badge
           -- means "you have something to go to", not "you have bookings".
           (SELECT COUNT(*)::int FROM booking
             WHERE resident_id = $1 AND status = 'confirmed'
               AND schedule BETWEEN now() - INTERVAL '30 minutes'
                                AND now() + INTERVAL '1 hour')            AS sessions`,
        [user_id]
      );
      Object.assign(counts, rows[0]);
    }

    if (role === 'lgu') {
      const { rows } = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM crisis_alert c
              JOIN "user" u ON u.user_id = c.user_id
             WHERE u.barangay_id = $1 AND c.status <> 'resolved')  AS alerts,
           -- An empty credit pool blocks the barangay from doing its job.
           (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END::int
              FROM care_credit
             WHERE barangay_id = $1 AND resident_id IS NULL
               AND status = 'available')                           AS budget`,
        [barangay_id]
      );
      Object.assign(counts, rows[0]);
    }

    if (role === 'admin') {
      const { rows } = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM "user" u
              JOIN psychologist p ON p.user_id = u.user_id
             WHERE u.status = 'pending')                            AS verification,
           (SELECT COUNT(*)::int FROM content_flag
             WHERE status = 'pending')                             AS moderation,
           (SELECT COUNT(*)::int FROM crisis_alert
             WHERE status <> 'resolved'
               AND created_at < now() - INTERVAL '7 days')          AS "ai-crisis",
           (SELECT COUNT(*)::int FROM subscription
             WHERE status = 'pending')                             AS subscriptions`,
        []
      );
      Object.assign(counts, rows[0]);
    }

    res.json({ counts });
  })
);

export default router;
