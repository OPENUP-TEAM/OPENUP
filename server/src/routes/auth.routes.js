import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { sendEmail, resetEmail } from '../services/email.service.js';
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

    // license_no is unique. Without this check the insert throws a raw
    // Postgres constraint violation and the applicant gets a 500 with no
    // idea what went wrong.
    if (data.role === 'psychologist') {
      const licence = await query(
        'SELECT 1 FROM psychologist WHERE license_no = $1',
        [data.license_no]
      );
      if (licence.rowCount)
        throw ApiError.conflict(
          'That PRC license number is already registered. If it is yours, contact an administrator.'
        );
    }

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


// ---------------------------------------------------------------------
// Forgotten password
//
// The token is generated here, hashed, and only the hash is stored. The
// plain token exists in the emailed URL and nowhere else, so a leaked
// database cannot be used to reset anyone's password.
// ---------------------------------------------------------------------

const RESET_MINUTES = 30;
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const { rows } = await query(
      `SELECT user_id, name, status FROM "user" WHERE email = $1`,
      [email]
    );
    const user = rows[0];

    /*
     * The response is the same whether or not the account exists.
     *
     * Saying "no account with that email" turns this endpoint into a way
     * to discover who has an account on a mental health service, which is
     * exactly the kind of thing someone might want to know about a
     * neighbour or an employee.
     */
    const generic = {
      ok: true,
      message: 'If that email has an account, a reset link is on its way. Check your inbox and your spam folder.',
    };

    if (!user) return res.json(generic);

    // A suspended account should not be recoverable by its owner.
    if (user.status === 'suspended') return res.json(generic);

    // Three requests per hour per account. Enough for someone whose email
    // is slow, not enough to flood an inbox.
    const { rows: recent } = await query(
      `SELECT COUNT(*)::int AS n FROM password_reset
        WHERE user_id = $1 AND created_at > now() - INTERVAL '1 hour'`,
      [user.user_id]
    );
    if (recent[0].n >= 3) return res.json(generic);

    const token = randomBytes(32).toString('base64url');

    await query(
      `INSERT INTO password_reset (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
      [user.user_id, hashToken(token), RESET_MINUTES, req.ip?.slice(0, 45) ?? null]
    );

    const base = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const url = `${base}/reset-password?token=${token}`;
    const { subject, text } = resetEmail(user.name, url, RESET_MINUTES);

    const result = await sendEmail({ to: email, subject, text }).catch((err) => {
      console.error('Reset email failed:', err.message);
      return { sent: false };
    });

    // In development there is no provider, so the link is printed to the
    // console. Returning it as well is only safe because it is gated on
    // NODE_ENV; in production the caller learns nothing.
    res.json({
      ...generic,
      ...(process.env.NODE_ENV !== 'production' && !result.sent
        ? { dev_note: 'No email provider configured. The reset link was printed to the server console.',
            dev_url: url }
        : {}),
    });
  })
);

/** Checks a token before showing the form, so a dead link fails early. */
router.get(
  '/reset-password/check',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    if (!token) throw ApiError.badRequest('No token.');

    const { rows } = await query(
      `SELECT r.reset_id, u.email
         FROM password_reset r JOIN "user" u ON u.user_id = r.user_id
        WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows.length)
      throw ApiError.badRequest('That link has expired or has already been used. Ask for a new one.');

    // Partially masked, so the person can tell they are resetting the
    // right account without the link itself disclosing an address.
    const [local, domain] = rows[0].email.split('@');
    res.json({
      valid: true,
      email_hint: `${local.slice(0, 2)}${'\u2022'.repeat(Math.max(1, local.length - 2))}@${domain}`,
    });
  })
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, new_password } = z
      .object({
        token: z.string().min(10),
        new_password: z.string().min(8, 'Use at least 8 characters.'),
      })
      .parse(req.body);

    const user = await withTransaction(async (client) => {
      // Locked so the same token cannot be spent twice concurrently.
      const { rows } = await client.query(
        `SELECT r.reset_id, r.user_id, u.email, u.role
           FROM password_reset r JOIN "user" u ON u.user_id = r.user_id
          WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()
          FOR UPDATE OF r`,
        [hashToken(token)]
      );
      const r = rows[0];
      if (!r)
        throw ApiError.badRequest('That link has expired or has already been used. Ask for a new one.');

      await client.query(
        'UPDATE "user" SET password = $2 WHERE user_id = $1',
        [r.user_id, await bcrypt.hash(new_password, 10)]
      );

      await client.query(
        'UPDATE password_reset SET used_at = now() WHERE reset_id = $1',
        [r.reset_id]
      );

      // Any other outstanding link is now void. If someone requested two
      // resets, the older one should not still work.
      await client.query(
        `UPDATE password_reset SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL`,
        [r.user_id]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'password.reset', 'user', $1, $2)`,
        [r.user_id, { via: 'reset_link' }]
      );

      return r;
    });

    res.json({
      ok: true,
      email: user.email,
      message: 'Your password has been changed. Sign in with the new one.',
    });
  })
);

// ---------------------------------------------------------------------
// Deleting your own account
//
// Table 8 lists Delete Account under the administrator. A data subject has
// the right to erasure under RA 10173 regardless, and asking someone else
// to delete your mental health records is not a reasonable way to exercise
// it. This is that right, done by the person themselves.
// ---------------------------------------------------------------------

/** What deletion will actually remove, counted before it happens. */
router.get(
  '/me/deletion-summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM mood_entry WHERE user_id = $1)            AS mood_entries,
         (SELECT COUNT(*)::int FROM voice_journal WHERE user_id = $1)         AS voice_journals,
         (SELECT COUNT(*)::int FROM assessment WHERE user_id = $1)            AS assessments,
         (SELECT COUNT(*)::int FROM booking WHERE resident_id = $1)           AS bookings,
         (SELECT COUNT(*)::int FROM message WHERE sender_id = $1)             AS messages,
         (SELECT COUNT(*)::int FROM testimonial WHERE user_id = $1)           AS posts,
         (SELECT COUNT(*)::int FROM ai_conversation WHERE user_id = $1)       AS companion_chats,
         (SELECT COUNT(*)::int FROM care_credit
           WHERE resident_id = $1 AND status = 'available')                   AS unused_credits,
         (SELECT COUNT(*)::int FROM booking
           WHERE resident_id = $1 AND status IN ('pending','confirmed')
             AND schedule > now())                                           AS upcoming_sessions`,
      [req.user.user_id]
    );

    const psychologist = req.user.role === 'psychologist'
      ? (await query(
          `SELECT COUNT(*)::int AS n FROM booking bk
             JOIN psychologist p ON p.psychologist_id = bk.psychologist_id
            WHERE p.user_id = $1`,
          [req.user.user_id]
        )).rows[0].n
      : 0;

    res.json({
      counts: rows[0],
      // A psychologist with session history cannot be erased outright: the
      // bookings belong to residents and to the barangay's records too.
      restricted: req.user.role === 'psychologist' && psychologist > 0,
      sessions_delivered: psychologist,
    });
  })
);

router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password, confirm } = z
      .object({
        password: z.string().min(1, 'Enter your password.'),
        confirm: z.literal('DELETE', {
          errorMap: () => ({ message: 'Type DELETE to confirm.' }),
        }),
      })
      .parse(req.body);

    const { rows } = await query(
      'SELECT password, role, email FROM "user" WHERE user_id = $1',
      [req.user.user_id]
    );
    if (!(await bcrypt.compare(password, rows[0].password)))
      throw ApiError.badRequest('That password is not correct.');

    const role = rows[0].role;

    // An administrator deleting themselves could leave nobody able to
    // administer the platform.
    if (role === 'admin') {
      const { rows: others } = await query(
        `SELECT COUNT(*)::int AS n FROM "user"
          WHERE role = 'admin' AND status = 'active' AND user_id <> $1`,
        [req.user.user_id]
      );
      if (others[0].n === 0)
        throw ApiError.badRequest(
          'You are the only active administrator. Promote someone else first.'
        );
    }

    const result = await withTransaction(async (client) => {
      /*
       * A psychologist who has delivered sessions is anonymised, not
       * deleted.
       *
       * Their bookings are also the residents' records and the barangay's
       * spending history; erasing them would take away someone else's
       * data. So the personal details go, the licence document goes, the
       * account is closed, and the session history survives without a name
       * attached to it.
       */
      if (role === 'psychologist') {
        const { rows: hist } = await client.query(
          `SELECT COUNT(*)::int AS n FROM booking bk
             JOIN psychologist p ON p.psychologist_id = bk.psychologist_id
            WHERE p.user_id = $1`,
          [req.user.user_id]
        );

        if (hist[0].n > 0) {
          await client.query(
            `UPDATE psychologist
                SET bio = NULL, license_doc_url = NULL, specialization = NULL,
                    languages = NULL, is_verified = false
              WHERE user_id = $1`,
            [req.user.user_id]
          );
          await client.query(
            `UPDATE "user"
                SET name = 'Former psychologist',
                    email = 'deleted-' || user_id || '@openup.invalid',
                    password = '',
                    display_alias = NULL,
                    status = 'suspended'
              WHERE user_id = $1`,
            [req.user.user_id]
          );
          // Availability removal stops them appearing bookable.
          await client.query('DELETE FROM availability WHERE psychologist_id IN (SELECT psychologist_id FROM psychologist WHERE user_id = $1)',
            [req.user.user_id]);

          await client.query(
            `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
             VALUES ($1, 'account.anonymise', 'user', $1, $2)`,
            [req.user.user_id, { role, sessions_kept: hist[0].n }]
          );

          return { anonymised: true, sessions_kept: hist[0].n };
        }
      }

      // Release any credit still held, so the barangay gets it back rather
      // than losing it with the account.
      await client.query(
        `UPDATE care_credit
            SET resident_id = NULL, assigned_by = NULL, assigned_at = NULL
          WHERE resident_id = $1 AND status = 'available'`,
        [req.user.user_id]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES (NULL, 'account.self_delete', 'user', $1, $2)`,
        [req.user.user_id, { role }]
      );

      await client.query('DELETE FROM "user" WHERE user_id = $1', [req.user.user_id]);

      return { anonymised: false };
    });

    res.json({
      ok: true,
      ...result,
      message: result.anonymised
        ? `Your personal details have been removed and your account closed. ${result.sessions_kept} session records remain without your name, because they are also your clients' and their barangays' records.`
        : 'Your account and everything in it has been deleted.',
    });
  })
);

export default router;
