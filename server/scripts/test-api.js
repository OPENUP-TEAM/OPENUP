import 'dotenv/config';
import pg from 'pg';

/**
 * End-to-end API test.
 *
 *   1. start the server:  npm run dev
 *   2. in a second terminal:  npm run test:api
 *
 * Exercises every implemented endpoint against the running server, then
 * cleans up the accounts it created. Read-only against seeded data except
 * where noted.
 */

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const stamp = Date.now();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let passed = 0;
let failed = 0;
const created = { users: [], bookings: [], conversations: [] };

const ok = (name, detail = '') => { passed++; console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, why) => { failed++; console.log(`  FAIL  ${name}\n        ${why}`); };

/** Assert helper that never throws the suite over. */
async function test(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (err) {
    bad(name, err.message);
  }
}

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function call(path, { method = 'GET', body, token, expectStatus } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (expectStatus && res.status !== expectStatus)
    throw new Error(`expected ${expectStatus}, got ${res.status}: ${payload.error || ''}`);
  return { status: res.status, ...payload };
}

const section = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------------
console.log('\nOpenUp API test\n');

// Is the server even up?
try {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  if (health.db !== 'connected') throw new Error('database not connected');
  console.log(`Server reachable, database connected.`);
} catch {
  console.log('Cannot reach the server. Start it with `npm run dev` first.\n');
  process.exit(1);
}

let residentToken, psyToken, lguToken, adminToken;
let residentId, bookingId, psychologistId, conversationId;

// --- Account Management ------------------------------------------------
section('Account Management');

const residentEmail = `test.resident.${stamp}@openup.ph`;
const psyEmail = `test.psy.${stamp}@openup.ph`;

await test('register resident', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    expectStatus: 201,
    body: {
      name: 'Test Resident', email: residentEmail, password: 'TestPass123!',
      barangay_id: 8, role: 'resident', display_alias: 'Test Alias',
    },
  });
  expect(r.token, 'no token returned');
  expect(r.user.role === 'resident', `role was ${r.user.role}`);
  expect(r.user.status === 'active', `status was ${r.user.status}`);
  residentToken = r.token;
  residentId = r.user.user_id;
  created.users.push(residentEmail);
  return `user_id ${residentId}`;
});

await test('register psychologist starts as pending', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    expectStatus: 201,
    body: {
      name: 'Test Psychologist', email: psyEmail, password: 'TestPass123!',
      barangay_id: 7, role: 'psychologist', license_no: `PSY-T${stamp}`,
      specialization: 'Testing', languages: 'English',
    },
  });
  expect(r.user.status === 'pending', `status was ${r.user.status}, expected pending`);
  created.users.push(psyEmail);
  return 'status pending, awaiting verification';
});

await test('psychologist registration requires a license number', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    body: {
      name: 'No License', email: `nolicense.${stamp}@openup.ph`,
      password: 'TestPass123!', barangay_id: 7, role: 'psychologist',
    },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected';
});

await test('duplicate email is rejected', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    body: {
      name: 'Dupe', email: residentEmail, password: 'TestPass123!',
      barangay_id: 8, role: 'resident',
    },
  });
  expect(r.status === 409, `expected 409, got ${r.status}`);
  return 'rejected with 409';
});

await test('short password is rejected', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    body: {
      name: 'Shorty', email: `short.${stamp}@openup.ph`, password: 'abc',
      barangay_id: 8, role: 'resident',
    },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected';
});

await test('consent rows written at sign-up', async () => {
  const { rows } = await pool.query(
    `SELECT consent_type, is_granted FROM consent WHERE user_id = $1 ORDER BY consent_type`,
    [residentId]
  );
  expect(rows.length === 2, `found ${rows.length} consent rows, expected 2`);
  expect(rows.every((r) => r.is_granted), 'a consent row was not granted');
  return rows.map((r) => r.consent_type).join(', ');
});

await test('login with correct password', async () => {
  const r = await call('/auth/login', {
    method: 'POST', expectStatus: 200,
    body: { email: residentEmail, password: 'TestPass123!' },
  });
  expect(r.token, 'no token');
  residentToken = r.token;
  return 'token issued';
});

await test('login with wrong password is rejected', async () => {
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email: residentEmail, password: 'WrongPass123!' },
  });
  expect(r.status === 401, `expected 401, got ${r.status}`);
  expect(!/not found|no account/i.test(r.error || ''),
    'error message reveals whether the email exists');
  return 'rejected without leaking account existence';
});

await test('login for unknown email gives the same error', async () => {
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email: `ghost.${stamp}@openup.ph`, password: 'TestPass123!' },
  });
  expect(r.status === 401, `expected 401, got ${r.status}`);
  return 'same 401, no enumeration';
});

await test('pending psychologist cannot sign in', async () => {
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email: psyEmail, password: 'TestPass123!' },
  });
  expect(r.status === 403, `expected 403, got ${r.status}`);
  return 'blocked until verified';
});

await test('protected route rejects a missing token', async () => {
  const r = await call('/auth/me');
  expect(r.status === 401, `expected 401, got ${r.status}`);
  return 'rejected';
});

await test('protected route rejects a forged token', async () => {
  const r = await call('/auth/me', { token: 'not.a.real.token' });
  expect(r.status === 401, `expected 401, got ${r.status}`);
  return 'rejected';
});

await test('GET /auth/me returns the signed-in user', async () => {
  const r = await call('/auth/me', { token: residentToken, expectStatus: 200 });
  expect(r.user.email === residentEmail, 'wrong user returned');
  expect(r.user.password === undefined, 'password hash leaked in response');
  return 'no password hash in payload';
});

await test('profile update', async () => {
  const r = await call('/auth/me', {
    method: 'PATCH', token: residentToken, expectStatus: 200,
    body: { name: 'Renamed Resident', display_alias: 'New Alias' },
  });
  expect(r.user.name === 'Renamed Resident', 'name not updated');
  expect(r.user.display_alias === 'New Alias', 'alias not updated');
  return 'name and alias changed';
});

await test('password change, then login with the new password', async () => {
  await call('/auth/change-password', {
    method: 'POST', token: residentToken, expectStatus: 200,
    body: { current_password: 'TestPass123!', new_password: 'NewPass456!' },
  });
  const r = await call('/auth/login', {
    method: 'POST', expectStatus: 200,
    body: { email: residentEmail, password: 'NewPass456!' },
  });
  residentToken = r.token;
  return 'old password replaced';
});

await test('password change rejects a wrong current password', async () => {
  const r = await call('/auth/change-password', {
    method: 'POST', token: residentToken,
    body: { current_password: 'DefinitelyWrong!', new_password: 'Another789!' },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected';
});

// --- Barangays ---------------------------------------------------------
section('Barangays');

await test('public barangay list', async () => {
  const r = await call('/barangays', { expectStatus: 200 });
  expect(r.barangays.length >= 18, `only ${r.barangays.length} barangays`);
  return `${r.barangays.length} returned, no auth needed`;
});

// --- Mood Tracking -----------------------------------------------------
section('Mood Tracking');

await test('log a mood', async () => {
  const r = await call('/moods', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: { mood_level: 4, note: 'Feeling okay' },
  });
  expect(r.entry.mood_level === 4, 'wrong level stored');
  return 'level 4 stored';
});

await test('re-logging the same day replaces the entry', async () => {
  await call('/moods', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: { mood_level: 2, note: 'Actually not great' },
  });
  const r = await call('/moods', { token: residentToken, expectStatus: 200 });
  const today = new Date().toISOString().slice(0, 10);
  const todays = r.entries.filter((e) => e.entry_date.slice(0, 10) === today);
  expect(todays.length === 1, `${todays.length} entries for today, expected 1`);
  expect(todays[0].mood_level === 2, `level is ${todays[0].mood_level}, expected 2`);
  return 'one row per day, value overwritten';
});

await test('mood level outside 1-5 is rejected', async () => {
  const r = await call('/moods', {
    method: 'POST', token: residentToken, body: { mood_level: 9 },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected';
});

await test('mood history', async () => {
  const r = await call('/moods?days=30', { token: residentToken, expectStatus: 200 });
  expect(Array.isArray(r.entries), 'entries not an array');
  return `${r.entries.length} entries`;
});

await test('weekly mood trends', async () => {
  const r = await call('/moods/trends', { token: residentToken, expectStatus: 200 });
  expect(Array.isArray(r.trends), 'trends not an array');
  return `${r.trends.length} week buckets`;
});

await test('one resident cannot read another resident\'s moods', async () => {
  const other = await call('/moods', { token: residentToken, expectStatus: 200 });
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM mood_entry WHERE user_id <> $1', [residentId]
  );
  expect(rows[0].n > 0, 'no other users have moods, test inconclusive');
  expect(other.entries.every((e) => true), 'unexpected');
  const mine = await pool.query(
    'SELECT COUNT(*)::int AS n FROM mood_entry WHERE user_id = $1', [residentId]
  );
  expect(other.entries.length === mine.rows[0].n,
    `endpoint returned ${other.entries.length} but user owns ${mine.rows[0].n}`);
  return 'scoped to the signed-in user';
});

// --- Psychologists -----------------------------------------------------
section('Psychologist browsing');

await test('list verified psychologists', async () => {
  const r = await call('/psychologists', { token: residentToken, expectStatus: 200 });
  expect(r.psychologists.length >= 1, 'no psychologists returned');
  psychologistId = r.psychologists[0].psychologist_id;
  return `${r.psychologists.length} verified`;
});

await test('unverified psychologists are excluded', async () => {
  const r = await call('/psychologists', { token: residentToken, expectStatus: 200 });
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM psychologist WHERE is_verified');
  expect(r.psychologists.length === rows[0].n,
    `endpoint returned ${r.psychologists.length}, database has ${rows[0].n} verified`);
  return 'only verified are listed';
});

await test('filter by language', async () => {
  const r = await call('/psychologists?language=Bisaya', { token: residentToken, expectStatus: 200 });
  return `${r.psychologists.length} match Bisaya`;
});

await test('open slots are generated from availability', async () => {
  // Find the next weekday that has availability configured.
  const { rows } = await pool.query(
    'SELECT day_of_week FROM availability WHERE psychologist_id = $1 AND is_active ORDER BY day_of_week',
    [psychologistId]
  );
  expect(rows.length, 'psychologist has no availability rows');
  const wanted = rows.map((r) => r.day_of_week);
  const d = new Date();
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    if (wanted.includes(d.getDay())) break;
  }
  const date = d.toISOString().slice(0, 10);
  const r = await call(`/psychologists/${psychologistId}/slots?date=${date}`, {
    token: residentToken, expectStatus: 200,
  });
  expect(r.slots.length > 0, `no slots returned for ${date}`);
  globalThis.__slot = r.slots[0];
  return `${r.slots.length} slots on ${date}`;
});

// --- Counseling Booking ------------------------------------------------
section('Counseling Booking');

await test('booking in the past is rejected', async () => {
  const r = await call('/bookings', {
    method: 'POST', token: residentToken,
    body: {
      psychologist_id: psychologistId,
      schedule: '2020-01-01T10:00:00.000Z',
    },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected';
});

await test('book a session', async () => {
  const r = await call('/bookings', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: {
      psychologist_id: psychologistId,
      schedule: new Date(globalThis.__slot).toISOString(),
      session_type: 'one_on_one',
    },
  });
  expect(r.booking.status === 'pending', `status was ${r.booking.status}`);
  expect(r.booking.room_name, 'no Jitsi room name generated');
  bookingId = r.booking.booking_id;
  created.bookings.push(bookingId);
  return `booking ${bookingId}, room ${r.booking.room_name}`;
});

await test('double-booking the same slot is refused', async () => {
  const r = await call('/bookings', {
    method: 'POST', token: residentToken,
    body: {
      psychologist_id: psychologistId,
      schedule: new Date(globalThis.__slot).toISOString(),
    },
  });
  expect(r.status === 409, `expected 409, got ${r.status}`);
  return 'rejected with 409';
});

await test('a payment row is created with the booking', async () => {
  const { rows } = await pool.query(
    'SELECT amount, status, method FROM payment WHERE booking_id = $1', [bookingId]
  );
  expect(rows.length === 1, `${rows.length} payment rows, expected 1`);
  expect(rows[0].status === 'pending', `payment status ${rows[0].status}`);
  return `₱${rows[0].amount}, pending`;
});

await test('the psychologist was notified', async () => {
  const { rows } = await pool.query(
    `SELECT n.message FROM notification n
       JOIN psychologist p ON p.user_id = n.user_id
      WHERE p.psychologist_id = $1 AND n.type = 'session'
      ORDER BY n.created_at DESC LIMIT 1`,
    [psychologistId]
  );
  expect(rows.length, 'no notification written');
  return 'notification row written';
});

await test('resident sees their own bookings', async () => {
  const r = await call('/bookings', { token: residentToken, expectStatus: 200 });
  expect(r.bookings.some((b) => b.booking_id === bookingId), 'booking missing from list');
  return `${r.bookings.length} bookings`;
});

// Care Credits: give the test resident one, then book with it.
await test('apply a Care Credit', async () => {
  await pool.query(
    `INSERT INTO care_credit (barangay_id, resident_id, amount, status)
     VALUES (8, $1, 800.00, 'available')`,
    [residentId]
  );
  const slot = new Date(globalThis.__slot);
  slot.setHours(slot.getHours() + 2);
  const r = await call('/bookings', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: {
      psychologist_id: psychologistId,
      schedule: slot.toISOString(),
      use_care_credit: true,
    },
  });
  expect(r.booking.care_credit_id, 'no credit attached');
  created.bookings.push(r.booking.booking_id);
  globalThis.__creditBooking = r.booking.booking_id;

  const { rows } = await pool.query(
    'SELECT status FROM care_credit WHERE credit_id = $1', [r.booking.care_credit_id]
  );
  expect(rows[0].status === 'reserved', `credit status ${rows[0].status}, expected reserved`);
  const pay = await pool.query(
    'SELECT status, method FROM payment WHERE booking_id = $1', [r.booking.booking_id]
  );
  expect(pay.rows[0].status === 'paid', `payment status ${pay.rows[0].status}`);
  expect(pay.rows[0].method === 'care_credit', `method ${pay.rows[0].method}`);
  return 'credit reserved, payment marked paid';
});

await test('booking with no credits left is refused', async () => {
  const slot = new Date(globalThis.__slot);
  slot.setHours(slot.getHours() + 4);
  const r = await call('/bookings', {
    method: 'POST', token: residentToken,
    body: {
      psychologist_id: psychologistId,
      schedule: slot.toISOString(),
      use_care_credit: true,
    },
  });
  expect(r.status === 400, `expected 400, got ${r.status}`);
  return 'rejected with a clear message';
});

await test('cancelling releases the reserved credit', async () => {
  const before = await pool.query(
    'SELECT care_credit_id FROM booking WHERE booking_id = $1', [globalThis.__creditBooking]
  );
  await call(`/bookings/${globalThis.__creditBooking}/cancel`, {
    method: 'PATCH', token: residentToken, expectStatus: 200,
  });
  const { rows } = await pool.query(
    'SELECT status FROM care_credit WHERE credit_id = $1', [before.rows[0].care_credit_id]
  );
  expect(rows[0].status === 'available', `credit status ${rows[0].status}, expected available`);
  return 'credit back to available';
});

await test('a resident cannot cancel someone else\'s booking', async () => {
  const { rows } = await pool.query(
    `SELECT booking_id FROM booking WHERE resident_id <> $1
       AND status IN ('pending','confirmed') LIMIT 1`,
    [residentId]
  );
  if (!rows.length) return 'skipped, no other bookings exist';
  const r = await call(`/bookings/${rows[0].booking_id}/cancel`, {
    method: 'PATCH', token: residentToken,
  });
  expect(r.status === 404, `expected 404, got ${r.status}`);
  return 'rejected';
});

await test('a resident cannot accept a booking', async () => {
  const r = await call(`/bookings/${bookingId}/status`, {
    method: 'PATCH', token: residentToken, body: { status: 'confirmed' },
  });
  expect(r.status === 403, `expected 403, got ${r.status}`);
  return 'role check enforced';
});

// --- Appointment Requests (psychologist side) --------------------------
section('Appointment Requests');

await test('sign in as the seeded psychologist', async () => {
  const r = await call('/auth/login', {
    method: 'POST', expectStatus: 200,
    body: { email: 'maria.santos@openup.ph', password: 'OpenUp123!' },
  });
  psyToken = r.token;
  return 'signed in';
});

await test('psychologist sees requests addressed to them', async () => {
  const r = await call('/bookings?status=pending', { token: psyToken, expectStatus: 200 });
  expect(r.bookings.some((b) => b.booking_id === bookingId),
    'the test booking is not in the psychologist\'s list');
  return `${r.bookings.length} pending`;
});

await test('accept a request', async () => {
  const r = await call(`/bookings/${bookingId}/status`, {
    method: 'PATCH', token: psyToken, expectStatus: 200,
    body: { status: 'confirmed' },
  });
  expect(r.booking.status === 'confirmed', `status ${r.booking.status}`);
  return 'confirmed';
});

await test('the resident was notified of the confirmation', async () => {
  const r = await call('/notifications', { token: residentToken, expectStatus: 200 });
  expect(r.notifications.some((n) => /confirmed/i.test(n.message)),
    'no confirmation notification');
  return 'notification received';
});

await test('completing a session consumes the credit', async () => {
  // New booking paid by credit, then mark it complete.
  await pool.query(
    `INSERT INTO care_credit (barangay_id, resident_id, amount, status)
     VALUES (8, $1, 800.00, 'available')`, [residentId]
  );
  const slot = new Date(globalThis.__slot);
  slot.setHours(slot.getHours() + 6);
  const b = await call('/bookings', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: {
      psychologist_id: psychologistId,
      schedule: slot.toISOString(),
      use_care_credit: true,
    },
  });
  created.bookings.push(b.booking.booking_id);
  await call(`/bookings/${b.booking.booking_id}/status`, {
    method: 'PATCH', token: psyToken, expectStatus: 200, body: { status: 'completed' },
  });
  const { rows } = await pool.query(
    'SELECT status FROM care_credit WHERE credit_id = $1', [b.booking.care_credit_id]
  );
  expect(rows[0].status === 'consumed', `credit status ${rows[0].status}, expected consumed`);
  return 'credit consumed';
});

await test('declining releases the credit', async () => {
  await pool.query(
    `INSERT INTO care_credit (barangay_id, resident_id, amount, status)
     VALUES (8, $1, 800.00, 'available')`, [residentId]
  );
  const slot = new Date(globalThis.__slot);
  slot.setHours(slot.getHours() + 8);
  const b = await call('/bookings', {
    method: 'POST', token: residentToken, expectStatus: 201,
    body: {
      psychologist_id: psychologistId,
      schedule: slot.toISOString(),
      use_care_credit: true,
    },
  });
  created.bookings.push(b.booking.booking_id);
  await call(`/bookings/${b.booking.booking_id}/status`, {
    method: 'PATCH', token: psyToken, expectStatus: 200, body: { status: 'declined' },
  });
  const { rows } = await pool.query(
    'SELECT status FROM care_credit WHERE credit_id = $1', [b.booking.care_credit_id]
  );
  expect(rows[0].status === 'available', `credit status ${rows[0].status}, expected available`);
  return 'credit released';
});

await test('a psychologist cannot change a booking that is not theirs', async () => {
  const { rows } = await pool.query(
    `SELECT booking_id FROM booking WHERE psychologist_id <> $1 LIMIT 1`, [psychologistId]
  );
  if (!rows.length) return 'skipped, only one psychologist has bookings';
  const r = await call(`/bookings/${rows[0].booking_id}/status`, {
    method: 'PATCH', token: psyToken, body: { status: 'confirmed' },
  });
  expect(r.status === 404, `expected 404, got ${r.status}`);
  return 'rejected';
});

// --- Notifications -----------------------------------------------------
section('Notifications');

await test('list notifications with an unread count', async () => {
  const r = await call('/notifications', { token: residentToken, expectStatus: 200 });
  expect(typeof r.unread === 'number', 'no unread count');
  globalThis.__notif = r.notifications[0]?.notification_id;
  return `${r.notifications.length} total, ${r.unread} unread`;
});

await test('mark one as read', async () => {
  if (!globalThis.__notif) return 'skipped, no notifications';
  await call(`/notifications/${globalThis.__notif}/read`, {
    method: 'PATCH', token: residentToken, expectStatus: 200,
  });
  const { rows } = await pool.query(
    'SELECT is_read FROM notification WHERE notification_id = $1', [globalThis.__notif]
  );
  expect(rows[0].is_read === true, 'not marked read');
  return 'marked read';
});

await test('mark all as read', async () => {
  await call('/notifications/read-all', {
    method: 'PATCH', token: residentToken, expectStatus: 200,
  });
  const r = await call('/notifications', { token: residentToken, expectStatus: 200 });
  expect(r.unread === 0, `${r.unread} still unread`);
  return 'unread count is 0';
});

// --- LGU analytics -----------------------------------------------------
section('LGU analytics');

await test('sign in as LGU', async () => {
  const r = await call('/auth/login', {
    method: 'POST', expectStatus: 200,
    body: { email: 'inayawan.lgu@openup.ph', password: 'OpenUp123!' },
  });
  lguToken = r.token;
  return 'signed in';
});

await test('a resident cannot reach LGU analytics', async () => {
  const r = await call('/lgu/dashboard', { token: residentToken });
  expect(r.status === 403, `expected 403, got ${r.status}`);
  return 'role check enforced';
});

await test('LGU dashboard', async () => {
  const r = await call('/lgu/dashboard', { token: lguToken, expectStatus: 200 });
  expect(typeof r.registered_residents === 'number', 'no resident count');
  return `${r.registered_residents} residents, index ${r.wellness?.wellness_index}`;
});

await test('heatmap returns every barangay', async () => {
  const r = await call('/lgu/heatmap', { token: lguToken, expectStatus: 200 });
  expect(r.barangays.length >= 18, `only ${r.barangays.length} barangays`);
  return `${r.barangays.length} barangays`;
});

await test('heatmap exposes no resident identity', async () => {
  const r = await call('/lgu/heatmap', { token: lguToken, expectStatus: 200 });
  const keys = Object.keys(r.barangays[0]);
  const leaks = keys.filter((k) => /name|email|user_id|alias/.test(k) && k !== 'barangay_name');
  expect(leaks.length === 0, `possible identity fields: ${leaks.join(', ')}`);
  return `fields: ${keys.join(', ')}`;
});

await test('wellness index history', async () => {
  const r = await call('/lgu/wellness-index/history', { token: lguToken, expectStatus: 200 });
  return `${r.history.length} days`;
});

await test('risk alerts are anonymised', async () => {
  const r = await call('/lgu/alerts', { token: lguToken, expectStatus: 200 });
  if (r.alerts.length) {
    const keys = Object.keys(r.alerts[0]);
    expect(!keys.includes('user_id'), 'user_id exposed in alerts');
    return `${r.alerts.length} alerts, fields: ${keys.join(', ')}`;
  }
  return '0 alerts (none in the last 30 days)';
});

await test('budget figures', async () => {
  const r = await call('/lgu/budget', { token: lguToken, expectStatus: 200 });
  expect(r.budget, 'no budget object');
  return `issued ₱${r.budget.credits_issued}, used ₱${r.budget.credits_used}`;
});

await test('AI effectiveness metrics', async () => {
  const r = await call('/lgu/ai-effectiveness', { token: lguToken, expectStatus: 200 });
  expect(r.metrics, 'no metrics object');
  return `${r.metrics.total_conversations} conversations tracked`;
});

// --- Anonymous Chat ----------------------------------------------------
section('Anonymous Chat');

console.log('  note  The chat handlers are Socket.IO only. There is no REST route to');
console.log('        create a conversation yet, so this checks the data layer instead.');

await test('conversation and message tables accept a thread', async () => {
  const c = await pool.query(
    `INSERT INTO conversation (resident_id, psychologist_id, is_anonymous)
     VALUES ($1, $2, true) RETURNING conversation_id`,
    [residentId, psychologistId]
  );
  conversationId = c.rows[0].conversation_id;
  created.conversations.push(conversationId);
  await pool.query(
    `INSERT INTO message (conversation_id, sender_id, content)
     VALUES ($1, $2, 'test message')`,
    [conversationId, residentId]
  );
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM message WHERE conversation_id = $1', [conversationId]
  );
  expect(rows[0].n === 1, 'message not stored');
  return `conversation ${conversationId} with 1 message`;
});

await test('resident has a display alias for masking', async () => {
  const { rows } = await pool.query(
    'SELECT display_alias FROM "user" WHERE user_id = $1', [residentId]
  );
  expect(rows[0].display_alias, 'no alias set, chat would fall back to "Anonymous resident"');
  return `alias "${rows[0].display_alias}"`;
});

// --- Cleanup -----------------------------------------------------------
section('Cleanup');

try {
  await pool.query('DELETE FROM conversation WHERE conversation_id = ANY($1)', [created.conversations]);
  await pool.query('DELETE FROM booking WHERE booking_id = ANY($1)', [created.bookings]);
  await pool.query('DELETE FROM care_credit WHERE resident_id = $1', [residentId]);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1)', [created.users]);
  ok('test accounts and bookings removed');
} catch (err) {
  bad('cleanup', err.message);
}

// ---------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
await pool.end();
process.exit(failed ? 1 : 0);
