import 'dotenv/config';
import pg from 'pg';

/**
 * Run with:  npm run verify
 *
 * Checks that the environment is wired up correctly before you start
 * building modules. Every failure prints what to do about it.
 */

const EXPECTED_TABLES = [
  // Data Dictionary (Table 7)
  'barangay', 'user', 'psychologist', 'booking', 'payment', 'mood_entry',
  'voice_journal', 'assessment', 'testimonial', 'comment', 'care_credit',
  'notification', 'subscription', 'consent',
  // Supporting tables for the 38 modules
  'conversation', 'message', 'availability', 'group_session', 'group_participant',
  'session_note', 'resource', 'ai_conversation', 'ai_message', 'trusted_contact',
  'crisis_alert', 'content_flag', 'accomplishment_report', 'system_setting', 'audit_log',
];

const EXPECTED_VIEWS = [
  'v_barangay_mood_daily',
  'v_community_wellness_index',
  'v_barangay_budget',
  'v_ai_effectiveness',
];

const pass = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg, fix) => {
  console.log(`  FAIL  ${msg}`);
  if (fix) console.log(`        -> ${fix}`);
  failures++;
};

let failures = 0;

console.log('\nOpenUp setup check\n');

// --- 1. Environment variables ------------------------------------------
console.log('Environment');
if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL is not set', 'Copy .env.example to .env and paste your Supabase URI.');
} else if (process.env.DATABASE_URL.includes('[ref]')) {
  fail('DATABASE_URL still has the placeholder in it',
       'Replace [ref] and [password] with your real Supabase values.');
} else {
  pass('DATABASE_URL is set');
  if (!process.env.DATABASE_URL.includes(':6543')) {
    console.log('  note  Not using port 6543. The direct connection is IPv6-only and');
    console.log('        usually fails on Philippine ISPs. Use the pooler URI.');
  }
}

if (!process.env.JWT_SECRET) {
  fail('JWT_SECRET is not set', 'Put any long random string in .env.');
} else if (process.env.JWT_SECRET.startsWith('change-this')) {
  fail('JWT_SECRET is still the default', 'Replace it with your own random string.');
} else if (process.env.JWT_SECRET.length < 24) {
  fail('JWT_SECRET is short', 'Use at least 24 characters.');
} else {
  pass('JWT_SECRET is set');
}

if (failures) {
  console.log(`\n${failures} problem(s) to fix before the database check can run.\n`);
  process.exit(1);
}

// --- 2. Database --------------------------------------------------------
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

try {
  console.log('\nDatabase connection');
  const { rows } = await pool.query('SELECT current_database() AS db, version() AS v');
  pass(`connected to ${rows[0].db}`);
  pass(rows[0].v.split(',')[0]);

  console.log('\nTables');
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const found = new Set(tables.map((t) => t.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !found.has(t));

  if (missing.length === EXPECTED_TABLES.length) {
    fail('no OpenUp tables exist', 'Run db/schema.sql in the Supabase SQL Editor.');
  } else if (missing.length) {
    fail(`missing ${missing.length}: ${missing.join(', ')}`,
         'Re-run db/schema.sql. It is wrapped in a transaction, so a partial run means it errored.');
  } else {
    pass(`all ${EXPECTED_TABLES.length} tables present`);
  }

  console.log('\nAnalytics views');
  const { rows: views } = await pool.query(
    `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`
  );
  const foundViews = new Set(views.map((v) => v.table_name));
  const missingViews = EXPECTED_VIEWS.filter((v) => !foundViews.has(v));
  missingViews.length
    ? fail(`missing: ${missingViews.join(', ')}`, 'Re-run the Section 3 block of db/schema.sql.')
    : pass(`all ${EXPECTED_VIEWS.length} views present`);

  console.log('\nSeed data');
  const counts = await pool.query(`
    SELECT (SELECT COUNT(*) FROM barangay)::int                          AS barangays,
           (SELECT COUNT(*) FROM "user")::int                            AS users,
           (SELECT COUNT(*) FROM psychologist WHERE is_verified)::int    AS verified_psychologists,
           (SELECT COUNT(*) FROM care_credit WHERE status='available')::int AS open_credits
  `);
  const c = counts.rows[0];
  c.barangays
    ? pass(`${c.barangays} barangays, ${c.users} users, ${c.verified_psychologists} verified psychologist(s), ${c.open_credits} Care Credit(s)`)
    : fail('no seed data', 'Run db/seed.sql in the Supabase SQL Editor.');

  console.log('\nWellness index view returns rows');
  const { rows: wi } = await pool.query(
    'SELECT barangay_name, wellness_index FROM v_community_wellness_index ORDER BY wellness_index LIMIT 3'
  );
  wi.length
    ? wi.forEach((r) => pass(`${r.barangay_name}: ${r.wellness_index}`))
    : fail('view returned nothing', 'Expected if seed data is missing.');

} catch (err) {
  fail(`could not query the database — ${err.message}`,
       'Check the password in DATABASE_URL, and that your Supabase project is not paused.');
} finally {
  await pool.end();
}

console.log(
  failures
    ? `\n${failures} problem(s) found. Fix them, then run npm run verify again.\n`
    : '\nEverything checks out. Start the server with npm run dev.\n'
);
process.exit(failures ? 1 : 0);
