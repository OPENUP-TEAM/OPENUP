import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------
// Module: Subscription Monitoring (Christine Joyce Ravanes)
//   1. View LGU Subscriptions
//   2. Track Payment Status
//   3. Manage Subscription Plans
//
// Subscription status drives Care Credit allocation: a barangay with no
// active subscription cannot receive credits. That link is what makes the
// business model real rather than decorative, so this screen is where a
// lapsed payment actually has consequences.
// ---------------------------------------------------------------------


/**
 * Tell a barangay's LGU account something about its subscription.
 *
 * Every change here has a consequence the barangay has to act on, so none
 * of them should be discovered later by something failing.
 */
async function notifyBarangay(barangayId, message) {
  const { rows } = await query(
    `SELECT user_id FROM "user"
      WHERE barangay_id = $1 AND role = 'lgu' AND status = 'active'`,
    [barangayId]
  );
  await Promise.all(
    rows.map((u) => notify(null, u.user_id, message, 'system', '/lgu/budget'))
  );
}

const PLANS = {
  basic:    { label: 'Basic',    amount: 10000, credits_hint: 12 },
  standard: { label: 'Standard', amount: 18000, credits_hint: 25 },
  premium:  { label: 'Premium',  amount: 25000, credits_hint: 40 },
};

router.get('/plans', (_req, res) =>
  res.json({ plans: Object.entries(PLANS).map(([key, v]) => ({ key, ...v })) })
);

/** 1. View LGU Subscriptions, 2. Track Payment Status. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status || null;

    const { rows } = await query(
      `SELECT s.subscription_id, s.barangay_id, s.plan, s.status, s.amount,
              s.start_date, s.end_date, s.created_at,
              b.name AS barangay_name,
              (SELECT COUNT(*)::int FROM "user" u
                WHERE u.barangay_id = b.barangay_id
                  AND u.role = 'resident' AND u.status = 'active') AS residents,
              (SELECT COUNT(*)::int FROM care_credit c
                WHERE c.barangay_id = b.barangay_id)               AS credits_allocated,
              (SELECT COUNT(*)::int FROM care_credit c
                WHERE c.barangay_id = b.barangay_id
                  AND c.status = 'consumed')                       AS credits_used,
              CASE
                WHEN s.status <> 'active' THEN NULL
                WHEN s.end_date IS NULL   THEN NULL
                ELSE (s.end_date - CURRENT_DATE)
              END AS days_remaining
         FROM subscription s
         JOIN barangay b ON b.barangay_id = s.barangay_id
        WHERE ($1::text IS NULL OR s.status = $1)
        ORDER BY
          CASE s.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
          s.end_date NULLS LAST, b.name`,
      [status]
    );

    // Barangays with no subscription at all are the ones worth chasing.
    const { rows: unsubscribed } = await query(
      `SELECT b.barangay_id, b.name,
              (SELECT COUNT(*)::int FROM "user" u
                WHERE u.barangay_id = b.barangay_id
                  AND u.role = 'resident' AND u.status = 'active') AS residents
         FROM barangay b
        WHERE NOT EXISTS (
          SELECT 1 FROM subscription s
           WHERE s.barangay_id = b.barangay_id AND s.status IN ('active','pending')
        )
        ORDER BY residents DESC, b.name`
    );

    const summary = rows.reduce(
      (t, r) => ({
        active: t.active + (r.status === 'active' ? 1 : 0),
        pending: t.pending + (r.status === 'pending' ? 1 : 0),
        expiring_soon:
          t.expiring_soon +
          (r.status === 'active' && r.days_remaining !== null && r.days_remaining <= 30 ? 1 : 0),
        revenue: t.revenue + (r.status === 'active' ? Number(r.amount) : 0),
      }),
      { active: 0, pending: 0, expiring_soon: 0, revenue: 0 }
    );

    res.json({ subscriptions: rows, unsubscribed, summary });
  })
);

/** 3. Manage Subscription Plans — create one. */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { barangay_id, plan, amount, start_date, months } = z
      .object({
        barangay_id: z.coerce.number().int().positive(),
        plan: z.enum(['basic', 'standard', 'premium']),
        amount: z.coerce.number().positive().optional(),
        start_date: z.string().date().optional(),
        months: z.coerce.number().int().min(1).max(36).default(12),
      })
      .parse(req.body);

    const created = await withTransaction(async (client) => {
      const { rows: b } = await client.query(
        'SELECT name FROM barangay WHERE barangay_id = $1',
        [barangay_id]
      );
      if (!b.length) throw ApiError.notFound('No such barangay.');

      const { rows: existing } = await client.query(
        `SELECT subscription_id FROM subscription
          WHERE barangay_id = $1 AND status IN ('active','pending')`,
        [barangay_id]
      );
      if (existing.length)
        throw ApiError.conflict(
          `${b[0].name} already has an active or pending subscription. Cancel it first, or renew instead.`
        );

      const { rows } = await client.query(
        `INSERT INTO subscription
           (barangay_id, plan, status, amount, start_date, end_date)
         VALUES ($1, $2, 'pending', $3,
                 COALESCE($4::date, CURRENT_DATE),
                 COALESCE($4::date, CURRENT_DATE) + ($5 || ' months')::interval)
         RETURNING *`,
        [barangay_id, plan, amount ?? PLANS[plan].amount, start_date ?? null, months]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'subscription.create', 'subscription', $2, $3)`,
        [req.user.user_id, rows[0].subscription_id, { barangay: b[0].name, plan, months }]
      );

      return rows[0];
    });

    res.status(201).json({ subscription: created });
  })
);

/**
 * 2. Track Payment Status — mark a pending subscription paid.
 *
 * This is the moment a barangay becomes able to receive Care Credits, so
 * the LGU account is told directly rather than left to notice.
 */
router.patch(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    const activated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE subscription SET status = 'active'
          WHERE subscription_id = $1 AND status = 'pending'
          RETURNING subscription_id, barangay_id, plan`,
        [req.params.id]
      );
      if (!rows.length)
        throw ApiError.badRequest('That subscription is not awaiting payment.');

      const { rows: lgu } = await client.query(
        `SELECT user_id FROM "user"
          WHERE barangay_id = $1 AND role = 'lgu' AND status = 'active'`,
        [rows[0].barangay_id]
      );
      await Promise.all(
        lgu.map((u) =>
          notify(client, u.user_id,
            'Your subscription is active. Care Credits can now be allocated to your barangay.',
            'system', '/lgu/budget')
        )
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'subscription.activate', 'subscription', $2, $3)`,
        [req.user.user_id, rows[0].subscription_id, { plan: rows[0].plan }]
      );

      return rows[0];
    });

    res.json({ ok: true, subscription_id: activated.subscription_id });
  })
);

/** Renew: extend the end date rather than creating a second row. */
router.patch(
  '/:id/renew',
  asyncHandler(async (req, res) => {
    const { months } = z
      .object({ months: z.coerce.number().int().min(1).max(36).default(12) })
      .parse(req.body);

    const { rows } = await query(
      `UPDATE subscription
          SET end_date = GREATEST(COALESCE(end_date, CURRENT_DATE), CURRENT_DATE)
                         + ($2 || ' months')::interval,
              status = 'active'
        WHERE subscription_id = $1 AND status IN ('active','expired')
        RETURNING subscription_id, barangay_id, end_date`,
      [req.params.id, months]
    );
    if (!rows.length) throw ApiError.badRequest('That subscription cannot be renewed.');

    await notifyBarangay(rows[0].barangay_id,
      `Your subscription was renewed until ${new Date(rows[0].end_date).toISOString().slice(0, 10)}.`);

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'subscription.renew', 'subscription', $2, $3)`,
      [req.user.user_id, req.params.id, { months }]
    );

    res.json({ ok: true, end_date: rows[0].end_date });
  })
);

/**
 * Cancel.
 *
 * Credits already issued stay with the barangay and its residents. A
 * lapsed subscription stops new allocation; it does not claw back sessions
 * someone is already counting on.
 */
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE subscription SET status = 'cancelled'
        WHERE subscription_id = $1 AND status IN ('active','pending')
        RETURNING subscription_id, barangay_id`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.badRequest('That subscription is not active.');

    const { rows: remaining } = await query(
      `SELECT COUNT(*)::int AS n FROM care_credit
        WHERE barangay_id = $1 AND status IN ('available','reserved')`,
      [rows[0].barangay_id]
    );

    // A cancelled subscription stops new credit allocation, so the barangay
    // finding out when allocation fails is the wrong way round.
    await notifyBarangay(rows[0].barangay_id,
      remaining[0].n > 0
        ? `Your subscription was cancelled. The ${remaining[0].n} Care Credit${remaining[0].n === 1 ? '' : 's'} already issued stay valid, but no new credits can be allocated.`
        : 'Your subscription was cancelled. No new Care Credits can be allocated.');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'subscription.cancel', 'subscription', $2, $3)`,
      [req.user.user_id, req.params.id, { credits_left: remaining[0].n }]
    );

    res.json({
      ok: true,
      credits_left: remaining[0].n,
      note: 'Credits already issued remain valid. No new credits can be allocated.',
    });
  })
);

/** Sweep subscriptions whose end date has passed. */
router.post(
  '/expire-lapsed',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      `UPDATE subscription SET status = 'expired'
        WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`
    );
    res.json({ expired: rowCount });
  })
);

export default router;
