import { Router } from 'express';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';

const router = Router();

// Public: needed by the sign-up form's barangay dropdown.
router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    'SELECT barangay_id, name, city FROM barangay ORDER BY name'
  );
  res.json({ barangays: rows });
}));

export default router;
