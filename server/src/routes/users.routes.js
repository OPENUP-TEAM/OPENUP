import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notify } from '../services/notification.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------
// Module: User Management (Christine Joyce Ravanes)
//   1. View Users  2. Search Users  3. Update Account Status
//
// Module: Manage LGU Accounts (Christine Joyce Ravanes)
//   1. Create  2. Update  3. Deactivate
//
// Also covers Account Management items 3 (Delete Account) and 5 (Manage
// Account Status), both of which are admin-only.
// ---------------------------------------------------------------------

/** 1. View Users, 2. Search Users. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, role, status, barangay_id } = req.query;

    const { rows } = await query(
      `SELECT u.user_id, u.name, u.email, u.role, u.status, u.display_alias,
              u.created_at, b.name AS barangay_name, b.barangay_id,
              p.psychologist_id, p.is_verified, p.license_no,
              (SELECT COUNT(*)::int FROM booking bk WHERE bk.resident_id = u.user_id) AS bookings,
              (SELECT MAX(created_at) FROM notification n WHERE n.user_id = u.user_id) AS last_activity
         FROM "user" u
         JOIN barangay b        ON b.barangay_id = u.barangay_id
         LEFT JOIN psychologist p ON p.user_id = u.user_id
        WHERE ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%'
                                OR u.email ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR u.role = $2)
          AND ($3::text IS NULL OR u.status = $3)
          AND ($4::bigint IS NULL OR u.barangay_id = $4)
        ORDER BY u.created_at DESC
        LIMIT 200`,
      [q?.trim() || null, role || null, status || null, barangay_id || null]
    );

    const { rows: counts } = await query(
      `SELECT role, status, COUNT(*)::int AS n FROM "user" GROUP BY role, status`
    );

    res.json({
      users: rows,
      counts: counts.reduce((acc, c) => {
        acc[c.role] = (acc[c.role] ?? 0) + c.n;
        acc[`${c.role}_${c.status}`] = c.n;
        return acc;
      }, {}),
    });
  })
);

/**
 * 3. Update Account Status.
 *
 * Suspension is the tool for conduct problems — an abusive resident, or a
 * psychologist behaving badly in chat. It takes effect on the next request
 * because requireAuth re-reads status from the database rather than
 * trusting the token, so a suspended user does not stay signed in until
 * their JWT expires.
 */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = z
      .object({
        status: z.enum(['active', 'suspended']),
        reason: z.string().trim().min(5, 'Give a reason that will make sense later.').max(255),
      })
      .parse(req.body);

    if (Number(req.params.id) === Number(req.user.user_id))
      throw ApiError.badRequest('You cannot change your own account status.');

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT user_id, name, role, status FROM "user" WHERE user_id = $1`,
        [req.params.id]
      );
      const u = rows[0];
      if (!u) throw ApiError.notFound('No such user.');

      // Losing every administrator would lock everyone out of the platform.
      if (u.role === 'admin' && status === 'suspended') {
        const { rows: admins } = await client.query(
          `SELECT COUNT(*)::int AS n FROM "user"
            WHERE role = 'admin' AND status = 'active' AND user_id <> $1`,
          [u.user_id]
        );
        if (admins[0].n === 0)
          throw ApiError.badRequest(
            'This is the only active administrator. Promote someone else first.'
          );
      }

      await client.query(`UPDATE "user" SET status = $2 WHERE user_id = $1`,
        [u.user_id, status]);

      await notify(client, u.user_id,
        status === 'suspended'
          ? `Your account has been suspended. ${reason}`
          : 'Your account has been reactivated.',
        'system', null);

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, $2, 'user', $3, $4)`,
        [req.user.user_id, status === 'suspended' ? 'user.suspend' : 'user.reactivate',
         u.user_id, { reason, role: u.role }]
      );

      return u;
    });

    res.json({ ok: true, user_id: updated.user_id, status });
  })
);

/**
 * Account Management 3 — Delete Account.
 *
 * Deletion cascades through moods, journals, bookings and messages. That
 * is correct for a data subject exercising their right to erasure under
 * the Data Privacy Act, but it is not reversible, so the caller has to
 * name the account they are deleting.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { confirm_email } = z
      .object({ confirm_email: z.string().email() })
      .parse(req.body);

    if (Number(req.params.id) === Number(req.user.user_id))
      throw ApiError.badRequest('You cannot delete your own account.');

    const { rows } = await query(
      'SELECT user_id, name, email, role FROM "user" WHERE user_id = $1',
      [req.params.id]
    );
    const u = rows[0];
    if (!u) throw ApiError.notFound('No such user.');

    if (u.email !== confirm_email)
      throw ApiError.badRequest('The email you typed does not match this account.');

    // Written before the delete, since the row is about to disappear.
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'user.delete', 'user', $2, $3)`,
      [req.user.user_id, u.user_id, { email: u.email, role: u.role, name: u.name }]
    );

    await query('DELETE FROM "user" WHERE user_id = $1', [u.user_id]);

    res.json({ ok: true, deleted: u.email });
  })
);

// ---------------------------------------------------------------------
// LGU accounts
// ---------------------------------------------------------------------

/** One LGU account per barangay, listed with what they have to work with. */
router.get(
  '/lgu/accounts',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT u.user_id, u.name, u.email, u.status, u.created_at,
              b.barangay_id, b.name AS barangay_name,
              (SELECT s.plan FROM subscription s
                WHERE s.barangay_id = b.barangay_id AND s.status = 'active'
                LIMIT 1) AS plan,
              (SELECT COUNT(*)::int FROM "user" r
                WHERE r.barangay_id = b.barangay_id AND r.role = 'resident') AS residents
         FROM "user" u
         JOIN barangay b ON b.barangay_id = u.barangay_id
        WHERE u.role = 'lgu'
        ORDER BY b.name`
    );

    const { rows: available } = await query(
      `SELECT barangay_id, name FROM barangay b
        WHERE NOT EXISTS (
          SELECT 1 FROM "user" u
           WHERE u.barangay_id = b.barangay_id AND u.role = 'lgu'
        )
        ORDER BY name`
    );

    res.json({ accounts: rows, barangays_without_account: available });
  })
);

/**
 * 1. Create LGU Account.
 *
 * The administrator does not choose the password. A temporary one is
 * generated and returned once, so nobody is tempted to set something
 * memorable and reuse it across barangays.
 */
router.post(
  '/lgu/accounts',
  asyncHandler(async (req, res) => {
    const { barangay_id, name, email } = z
      .object({
        barangay_id: z.coerce.number().int().positive(),
        name: z.string().trim().min(2).max(100),
        email: z.string().email().max(100),
      })
      .parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows: b } = await client.query(
        'SELECT name FROM barangay WHERE barangay_id = $1', [barangay_id]
      );
      if (!b.length) throw ApiError.notFound('No such barangay.');

      const { rowCount: taken } = await client.query(
        'SELECT 1 FROM "user" WHERE email = $1', [email]
      );
      if (taken) throw ApiError.conflict('That email is already registered.');

      const { rowCount: exists } = await client.query(
        `SELECT 1 FROM "user" WHERE barangay_id = $1 AND role = 'lgu'`, [barangay_id]
      );
      if (exists)
        throw ApiError.conflict(`${b[0].name} already has an LGU account.`);

      // URL-safe, and long enough that it is not worth guessing.
      const tempPassword = randomBytes(9).toString('base64url');

      const { rows } = await client.query(
        `INSERT INTO "user" (barangay_id, name, email, password, role, status)
         VALUES ($1, $2, $3, $4, 'lgu', 'active')
         RETURNING user_id, name, email`,
        [barangay_id, name, email, await bcrypt.hash(tempPassword, 10)]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
         VALUES ($1, 'lgu.create', 'user', $2, $3)`,
        [req.user.user_id, rows[0].user_id, { barangay: b[0].name, email }]
      );

      return { ...rows[0], barangay: b[0].name, temp_password: tempPassword };
    });

    res.status(201).json({
      account: result,
      note: 'Give this password to the barangay directly. It is shown once and cannot be retrieved later.',
    });
  })
);

/** 2. Update LGU Account. */
router.patch(
  '/lgu/accounts/:id',
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        name: z.string().trim().min(2).max(100).optional(),
        email: z.string().email().max(100).optional(),
      })
      .parse(req.body);

    const fields = Object.keys(patch);
    if (!fields.length) throw ApiError.badRequest('Nothing to update.');

    if (patch.email) {
      const { rowCount } = await query(
        'SELECT 1 FROM "user" WHERE email = $1 AND user_id <> $2',
        [patch.email, req.params.id]
      );
      if (rowCount) throw ApiError.conflict('That email is already registered.');
    }

    const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE "user" SET ${set}
        WHERE user_id = $1 AND role = 'lgu'
        RETURNING user_id, name, email, status`,
      [req.params.id, ...fields.map((f) => patch[f])]
    );
    if (!rows.length) throw ApiError.notFound('No such LGU account.');

    res.json({ account: rows[0] });
  })
);

/** Reset an LGU password, for the inevitable forgotten one. */
router.post(
  '/lgu/accounts/:id/reset-password',
  asyncHandler(async (req, res) => {
    const tempPassword = randomBytes(9).toString('base64url');

    const { rows } = await query(
      `UPDATE "user" SET password = $2
        WHERE user_id = $1 AND role = 'lgu'
        RETURNING user_id, email`,
      [req.params.id, await bcrypt.hash(tempPassword, 10)]
    );
    if (!rows.length) throw ApiError.notFound('No such LGU account.');

    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1, 'lgu.reset_password', 'user', $2, $3)`,
      [req.user.user_id, rows[0].user_id, { email: rows[0].email }]
    );

    res.json({
      email: rows[0].email,
      temp_password: tempPassword,
      note: 'Shown once. Give it to the barangay directly.',
    });
  })
);

export default router;
