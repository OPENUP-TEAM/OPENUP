import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Module: Care Credits Segregation (Christine, admin)
//   1. Allocate Care Credits
//   2. Segregate per Barangay
//   3. Track Distribution
//
// Module: Resource & Budget Management (Christine, LGU)
//   1. View Resource Allocation   4. Monitor Credit Usage
//   2. Assign / Adjust Resources  5. View Subscription Costs
//   3. Fund Care Credits          6. View Program Spending
//                                 7. Track Utilization
//
// Two tiers on purpose. An administrator allocates a batch to a barangay,
// and the barangay decides which of its own residents receive them. A
// platform admin has no basis for deciding that a particular household in
// Inayawan needs counseling; the barangay does.
// ---------------------------------------------------------------------

const ADMIN_ONLY = requireRole('admin');
const LGU_ONLY = requireRole('lgu', 'admin');

/** 3. Track Distribution — every barangay, for the admin. */
router.get(
  '/distribution',
  ADMIN_ONLY,
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT d.*,
              (SELECT COUNT(*)::int FROM "user" u
                WHERE u.barangay_id = d.barangay_id
                  AND u.role = 'resident' AND u.status = 'active') AS resident_count,
              (SELECT s.plan FROM subscription s
                WHERE s.barangay_id = d.barangay_id AND s.status = 'active'
                ORDER BY s.start_date DESC LIMIT 1)                AS plan
         FROM v_credit_distribution d
        ORDER BY d.barangay_name`
    );
    res.json({
      barangays: rows,
      totals: rows.reduce(
        (t, r) => ({
          pool_value: t.pool_value + Number(r.pool_value),
          consumed_value: t.consumed_value + Number(r.consumed_value),
          total_value: t.total_value + Number(r.total_value),
        }),
        { pool_value: 0, consumed_value: 0, total_value: 0 }
      ),
    });
  })
);

/**
 * 1. Allocate Care Credits / 2. Segregate per Barangay.
 *
 * Creates a batch of unassigned credits held by the barangay. They are not
 * attached to any resident until the barangay assigns them.
 */
router.post(
  '/allocate',
  ADMIN_ONLY,
  asyncHandler(async (req, res) => {
    const { barangay_id, count, amount, expires_at, note } = z
      .object({
        barangay_id: z.coerce.number().int().positive(),
        count: z.coerce.number().int().min(1).max(500),
        amount: z.coerce.number().positive().max(100000),
        expires_at: z.string().date().optional(),
        note: z.string().trim().max(255).optional(),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows: b } = await client.query(
        'SELECT name FROM barangay WHERE barangay_id = $1',
        [barangay_id]
      );
      if (!b.length) throw ApiError.notFound('No such barangay.');

      // A barangay with no active subscription has not paid for credits.
      const { rows: sub } = await client.query(
        `SELECT subscription_id FROM subscription
          WHERE barangay_id = $1 AND status = 'active'`,
        [barangay_id]
      );
      if (!sub.length)
        throw ApiError.badRequest(
          `${b[0].name} has no active subscription, so credits cannot be allocated to it yet.`
        );

      // One multi-row insert rather than a loop of single inserts.
      const { rows } = await client.query(
        `INSERT INTO care_credit
           (barangay_id, resident_id, amount, status, expires_at, allocated_by, batch_note)
         SELECT $1, NULL, $2, 'available', $3::date, $4, $5
           FROM generate_series(1, $6)
         RETURNING credit_id`,
        [barangay_id, amount, expires_at ?? null, req.user.user_id, note ?? null, count]
      );

      const { rows: lgu } = await client.query(
        `SELECT user_id FROM "user"
          WHERE barangay_id = $1 AND role = 'lgu' AND status = 'active'`,
        [barangay_id]
      );
      await Promise.all(
        lgu.map((u) =>
          notify(client, u.user_id,
            `${count} Care Credits were allocated to your barangay.`,
            'system', '/lgu/budget')
        )
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'credits.allocate', 'barangay', $2, $3)`,
        [req.user.user_id, barangay_id, { count, amount, note: note ?? null }]
      );

      return { created: rows.length, barangay: b[0].name };
    });

    res.status(201).json(result);
  })
);

/** Withdraw unassigned credits from a barangay pool. */
router.post(
  '/withdraw',
  ADMIN_ONLY,
  asyncHandler(async (req, res) => {
    const { barangay_id, count } = z
      .object({
        barangay_id: z.coerce.number().int().positive(),
        count: z.coerce.number().int().min(1).max(500),
      })
      .parse(req.body);

    // Only unassigned credits can be pulled back. Anything already given to
    // a resident stays theirs.
    const { rowCount } = await query(
      `DELETE FROM care_credit
        WHERE credit_id IN (
          SELECT credit_id FROM care_credit
           WHERE barangay_id = $1 AND resident_id IS NULL AND status = 'available'
           ORDER BY issued_at
           LIMIT $2
        )`,
      [barangay_id, count]
    );

    if (!rowCount)
      throw ApiError.badRequest('That barangay has no unassigned credits to withdraw.');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'credits.withdraw', 'barangay', $2, $3)`,
      [req.user.user_id, barangay_id, { count: rowCount }]
    );

    res.json({ withdrawn: rowCount });
  })
);

// ---------------------------------------------------------------------
// LGU side
// ---------------------------------------------------------------------

/** 1. View Resource Allocation, 4. Monitor Credit Usage, 7. Track Utilization. */
router.get(
  '/budget',
  LGU_ONLY,
  asyncHandler(async (req, res) => {
    const barangayId = req.user.barangay_id;

    const [dist, subs, recent] = await Promise.all([
      query('SELECT * FROM v_credit_distribution WHERE barangay_id = $1', [barangayId]),
      query(
        `SELECT subscription_id, plan, status, amount, start_date, end_date
           FROM subscription WHERE barangay_id = $1 ORDER BY start_date DESC`,
        [barangayId]
      ),
      // 6. View Program Spending — consumption over the last 6 months.
      query(
        `SELECT date_trunc('month', b.schedule)::date AS month,
                COUNT(*)::int                          AS sessions,
                COALESCE(SUM(c.amount), 0)             AS spent
           FROM care_credit c
           JOIN booking b ON b.care_credit_id = c.credit_id
          WHERE c.barangay_id = $1 AND c.status = 'consumed'
            AND b.schedule >= date_trunc('month', now()) - INTERVAL '5 months'
          GROUP BY month ORDER BY month`,
        [barangayId]
      ),
    ]);

    res.json({
      distribution: dist.rows[0] ?? null,
      subscriptions: subs.rows,
      spending: recent.rows,
    });
  })
);

/** Residents eligible to receive a credit, with what they already hold. */
router.get(
  '/residents',
  LGU_ONLY,
  asyncHandler(async (req, res) => {
    const q = req.query.q?.trim() || null;
    const { rows } = await query(
      `SELECT u.user_id, u.name, u.display_alias,
              COUNT(c.credit_id) FILTER (WHERE c.status = 'available')::int AS available,
              COUNT(c.credit_id) FILTER (WHERE c.status = 'reserved')::int  AS reserved,
              COUNT(c.credit_id) FILTER (WHERE c.status = 'consumed')::int  AS consumed
         FROM "user" u
         LEFT JOIN care_credit c ON c.resident_id = u.user_id
        WHERE u.barangay_id = $1 AND u.role = 'resident' AND u.status = 'active'
          AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%')
        GROUP BY u.user_id, u.name, u.display_alias
        ORDER BY u.name`,
      [req.user.barangay_id, q]
    );
    res.json({ residents: rows });
  })
);

/**
 * 2. Assign / Adjust Resources, 3. Fund Care Credits.
 *
 * Moves credits out of the barangay pool and onto a named resident.
 */
router.post(
  '/assign',
  LGU_ONLY,
  asyncHandler(async (req, res) => {
    const { resident_id, count } = z
      .object({
        resident_id: z.coerce.number().int().positive(),
        count: z.coerce.number().int().min(1).max(20),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows: r } = await client.query(
        `SELECT user_id, name FROM "user"
          WHERE user_id = $1 AND barangay_id = $2 AND role = 'resident'`,
        [resident_id, req.user.barangay_id]
      );
      if (!r.length)
        throw ApiError.notFound('That resident is not registered in your barangay.');

      // SKIP LOCKED so two LGU staff assigning at once cannot hand out the
      // same credit twice.
      const { rows: picked } = await client.query(
        `SELECT credit_id FROM care_credit
          WHERE barangay_id = $1 AND resident_id IS NULL AND status = 'available'
          ORDER BY issued_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [req.user.barangay_id, count]
      );

      if (picked.length < count)
        throw ApiError.badRequest(
          picked.length === 0
            ? 'Your barangay has no unassigned credits left. Request more from the administrator.'
            : `Only ${picked.length} credit${picked.length === 1 ? '' : 's'} left in the pool.`
        );

      await client.query(
        `UPDATE care_credit
            SET resident_id = $2, assigned_by = $3, assigned_at = now()
          WHERE credit_id = ANY($1)`,
        [picked.map((p) => p.credit_id), resident_id, req.user.user_id]
      );

      await notify(client, resident_id,
        `Your barangay gave you ${count} Care Credit${count === 1 ? '' : 's'} for counseling sessions.`,
        'system', '/app/book');

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'credits.assign', 'user', $2, $3)`,
        [req.user.user_id, resident_id, { count }]
      );

      return { assigned: picked.length, resident: r[0].name };
    });

    res.status(201).json(result);
  })
);

/** Reclaim unused credits from a resident, back into the pool. */
router.post(
  '/reclaim',
  LGU_ONLY,
  asyncHandler(async (req, res) => {
    const { resident_id, count } = z
      .object({
        resident_id: z.coerce.number().int().positive(),
        count: z.coerce.number().int().min(1).max(20),
      })
      .parse(req.body);

    // Only untouched credits. A reserved credit is holding a booked session,
    // and pulling it would cancel someone's appointment without telling them.
    const { rowCount } = await query(
      `UPDATE care_credit
          SET resident_id = NULL, assigned_by = NULL, assigned_at = NULL
        WHERE credit_id IN (
          SELECT credit_id FROM care_credit
           WHERE resident_id = $1 AND barangay_id = $2 AND status = 'available'
           ORDER BY assigned_at DESC NULLS LAST
           LIMIT $3
        )`,
      [resident_id, req.user.barangay_id, count]
    );

    if (!rowCount)
      throw ApiError.badRequest('That resident has no unused credits to reclaim.');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'credits.reclaim', 'user', $2, $3)`,
      [req.user.user_id, resident_id, { count: rowCount }]
    );

    res.json({ reclaimed: rowCount });
  })
);

export default router;
