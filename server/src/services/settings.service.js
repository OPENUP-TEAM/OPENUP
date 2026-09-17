import { query } from '../config/db.js';

/**
 * Reads configurable settings, with the built-in default when no row
 * exists.
 *
 * Cached for a short time because these are read on every session join and
 * every booking, and they change perhaps twice a year. Thirty seconds
 * means an administrator sees their change take effect while testing,
 * without a database round trip per request.
 *
 * Anything exposed on the settings screen must be read through here. A
 * control that edits a row nothing reads is worse than no control: it
 * tells an administrator they have changed something when they have not.
 */

const DEFAULTS = {
  session_window: { open_before_min: 15, close_after_min: 90 },
  booking_rules: { duration_min: 60, max_days_ahead: 14 },
};

const TTL_MS = 30_000;
const cache = new Map(); // key -> { value, at }

export async function getSetting(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = DEFAULTS[key];
  try {
    const { rows } = await query('SELECT value FROM system_setting WHERE key = $1', [key]);
    if (rows[0]?.value) value = { ...DEFAULTS[key], ...rows[0].value };
  } catch {
    // A settings lookup must never take down the feature it configures.
  }

  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Called after a write so the admin sees the change immediately. */
export const invalidateSetting = (key) =>
  key ? cache.delete(key) : cache.clear();

export const getSessionWindow = () => getSetting('session_window');
export const getBookingRules = () => getSetting('booking_rules');
