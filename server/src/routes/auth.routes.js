import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Module: Account Management — 1. Create Account
const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(100),
  password: z.string().min(8, 'Use at least 8 characters.'),
  barangay_id: z.coerce.number().int().positive(),
  role: z.enum(['resident', 'psychologist']).default('resident'),
  display_alias: z.string().max(50).optional(),
  // psychologists only
  license_no: z.string().max(50).optional(),
  specialization: z.string().max(100).optional(),
  languages: z.string().max(100).optional(),
});

const signToken = (user) =>
  jwt.sign({ sub: user.user_id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const publicUser = (u) => ({
  user_id: u.user_id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  barangay_id: u.barangay_id,
  display_alias: u.display_alias,
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    if (data.role === 'psychologist' && !data.license_no)
      throw ApiError.badRequest('Enter your PRC license number.');

    const existing = await query('SELECT 1 FROM "user" WHERE email = $1', [data.email]);
    if (existing.rowCount) throw ApiError.conflict('That email is already registered.');

    const hash = await bcrypt.hash(data.password, 10);

    // Psychologists start as pending until an admin verifies the license.
    const status = data.role === 'psychologist' ? 'pending' : 'active';

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO "user" (barangay_id, name, email, password, role, status, display_alias)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING user_id, barangay_id, name, email, role, status, display_alias`,
        [data.barangay_id, data.name, data.email, hash, data.role, status, data.display_alias ?? null]
      );
      const created = rows[0];

      if (data.role === 'psychologist') {
        await client.query(
          `INSERT INTO psychologist (user_id, license_no, specialization, languages)
           VALUES ($1,$2,$3,$4)`,
          [created.user_id, data.license_no, data.specialization ?? null, data.languages ?? null]
        );
      }

      // Data Governance & Consent module: record consent at sign-up.
      await client.query(
        `INSERT INTO consent (user_id, consent_type, is_granted)
         VALUES ($1,'data_use',true), ($1,'lgu_analytics',true)`,
        [created.user_id]
      );

      return created;
    });

    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  })
);

// Module: Account Management — 4. Authentication / Security
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const { rows } = await query(
      `SELECT user_id, barangay_id, name, email, password, role, status, display_alias
         FROM "user" WHERE email = $1`,
      [email]
    );
    const user = rows[0];

    // Same message either way so the form does not reveal which emails exist.
    const ok = user && (await bcrypt.compare(password, user.password));
    if (!ok) throw ApiError.unauthorized('That email and password do not match.');

    if (user.status === 'suspended')
      throw ApiError.forbidden('This account is suspended. Contact the administrator.');

    // Pending and rejected psychologists are allowed in deliberately. They
    // need the verification screen to read the reviewer's reason, upload a
    // corrected license, and check their status. Every other route is gated
    // by requireVerifiedPsychologist, so they can reach nothing else.
    if (user.status === 'rejected' && user.role !== 'psychologist')
      throw ApiError.forbidden('This account is not active. Contact the administrator.');

    res.json({ user: publicUser(user), token: signToken(user) });
  })
);

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Module: Account Management — 2. Update Account
router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        name: z.string().min(2).max(100).optional(),
        display_alias: z.string().max(50).nullable().optional(),
        barangay_id: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body);

    const fields = Object.keys(patch);
    if (!fields.length) throw ApiError.badRequest('Nothing to update.');

    const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE "user" SET ${set} WHERE user_id = $1
       RETURNING user_id, barangay_id, name, email, role, status, display_alias`,
      [req.user.user_id, ...fields.map((f) => patch[f])]
    );
    res.json({ user: publicUser(rows[0]) });
  })
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = z
      .object({ current_password: z.string(), new_password: z.string().min(8) })
      .parse(req.body);

    const { rows } = await query('SELECT password FROM "user" WHERE user_id = $1', [
      req.user.user_id,
    ]);
    if (!(await bcrypt.compare(current_password, rows[0].password)))
      throw ApiError.badRequest('Your current password is incorrect.');

    await query('UPDATE "user" SET password = $2 WHERE user_id = $1', [
      req.user.user_id,
      await bcrypt.hash(new_password, 10),
    ]);
    res.json({ ok: true });
  })
);

export default router;