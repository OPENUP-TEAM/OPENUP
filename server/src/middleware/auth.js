import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/http.js';
import { query } from '../config/db.js';

/** Verifies the bearer token and attaches req.user. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT user_id, barangay_id, name, email, role, status, display_alias
         FROM "user" WHERE user_id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user) throw ApiError.unauthorized();
    if (user.status === 'suspended')
      throw ApiError.forbidden('This account is suspended. Contact the administrator.');

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
      return next(ApiError.unauthorized('Your session expired. Sign in again.'));
    next(err);
  }
}

/** requireRole('psychologist', 'admin') */
export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(ApiError.forbidden());

/** Psychologists must be verified before they can take bookings. */
export async function requireVerifiedPsychologist(req, _res, next) {
  const { rows } = await query(
    `SELECT psychologist_id, is_verified FROM psychologist WHERE user_id = $1`,
    [req.user.user_id]
  );
  const p = rows[0];
  if (!p) return next(ApiError.forbidden('No psychologist profile on this account.'));
  if (!p.is_verified)
    return next(ApiError.forbidden('Your license is still being reviewed.'));
  req.psychologist = p;
  next();
}
