import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('lgu', 'admin'));

// Module: LGU Dashboard — "Your Barangay" panel (Figure 40).
router.get('/dashboard', asyncHandler(async (req, res) => {
  const barangayId = req.user.barangay_id;
  const [residents, credits, index, alerts] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM "user"
            WHERE barangay_id = $1 AND role = 'resident' AND status = 'active'`, [barangayId]),
    query('SELECT * FROM v_barangay_budget WHERE barangay_id = $1', [barangayId]),
    query('SELECT * FROM v_community_wellness_index WHERE barangay_id = $1', [barangayId]),
    query(`SELECT COUNT(*)::int AS n
             FROM crisis_alert c JOIN "user" u ON u.user_id = c.user_id
            WHERE u.barangay_id = $1 AND c.status = 'open'`, [barangayId]),
  ]);

  res.json({
    barangay_id: barangayId,
    registered_residents: residents.rows[0].n,
    high_risk_open: alerts.rows[0].n,
    budget: credits.rows[0] ?? null,
    wellness: index.rows[0] ?? null,
  });
}));

// Module: Mental Health Heatmap — citywide comparison (Figure 41).
// Aggregate only; no resident identity or session content is returned.
router.get('/heatmap', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT barangay_id, barangay_name, resident_count, avg_mood,
            crisis_count, wellness_index
       FROM v_community_wellness_index
      ORDER BY wellness_index`
  );
  res.json({ barangays: rows });
}));

// Module: Community Wellness Index — 2. Compare by Period.
router.get('/wellness-index/history', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT entry_date, avg_mood, entry_count
       FROM v_barangay_mood_daily
      WHERE barangay_id = $1 AND entry_date >= CURRENT_DATE - 90
      ORDER BY entry_date`,
    [req.user.barangay_id]
  );
  res.json({ history: rows });
}));

// Module: Barangay Risk Alerts — 1. View Risk Alerts (city-wide, anonymised).
router.get('/alerts', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT b.name AS barangay_name, c.risk_level, c.source, c.status, c.created_at
       FROM crisis_alert c
       JOIN "user" u   ON u.user_id = c.user_id
       JOIN barangay b ON b.barangay_id = u.barangay_id
      WHERE c.created_at >= now() - INTERVAL '30 days'
      ORDER BY c.created_at DESC LIMIT 100`
  );
  res.json({ alerts: rows });
}));

// Module: Resource & Budget Management — 5/6/7.
router.get('/budget', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_barangay_budget WHERE barangay_id = $1',
    [req.user.barangay_id]);
  const subs = await query(
    `SELECT plan, status, amount, start_date, end_date FROM subscription
      WHERE barangay_id = $1 ORDER BY start_date DESC`,
    [req.user.barangay_id]);
  res.json({ budget: rows[0] ?? null, subscriptions: subs.rows });
}));

// Module: AI Effectiveness Tracker.
router.get('/ai-effectiveness', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM v_ai_effectiveness');
  res.json({ metrics: rows[0] });
}));

export default router;
