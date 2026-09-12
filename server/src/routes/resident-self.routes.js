import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('resident'));

/**
 * Care Credit balance.
 *
 * A resident needs to know how many sessions their barangay has covered
 * before they pick a slot, otherwise "use a Care Credit" is a checkbox
 * that might fail at submit. Reserved credits are shown separately
 * because they are spent-but-not-yet-consumed: the session has not
 * happened, so cancelling gets them back.
 */
router.get(
  '/credits',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'available'
                          AND (expires_at IS NULL OR expires_at > now()))::int AS available,
         COUNT(*) FILTER (WHERE status = 'reserved')::int                      AS reserved,
         COUNT(*) FILTER (WHERE status = 'consumed')::int                      AS consumed,
         COUNT(*) FILTER (WHERE status = 'available' AND expires_at <= now())::int AS expired,
         COALESCE(SUM(amount) FILTER (WHERE status = 'available'
                          AND (expires_at IS NULL OR expires_at > now())), 0)  AS available_value,
         MIN(expires_at) FILTER (WHERE status = 'available'
                          AND expires_at > now())                              AS next_expiry
       FROM care_credit
      WHERE resident_id = $1`,
      [req.user.user_id]
    );

    const b = rows[0];
    res.json({
      available: b.available,
      reserved: b.reserved,
      consumed: b.consumed,
      expired: b.expired,
      available_value: Number(b.available_value),
      next_expiry: b.next_expiry,
    });
  })
);

/** Individual credits, for a "where did my credits go" view. */
router.get(
  '/credits/history',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.credit_id, c.amount, c.status, c.issued_at, c.expires_at,
              b.schedule AS used_for_session
         FROM care_credit c
         LEFT JOIN booking b ON b.care_credit_id = c.credit_id
        WHERE c.resident_id = $1
        ORDER BY c.issued_at DESC`,
      [req.user.user_id]
    );
    res.json({ credits: rows });
  })
);

export default router;