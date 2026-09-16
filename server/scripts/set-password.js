import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

/**
 * Set a user's password.
 *
 *   npm run set-password -- juan@openup.ph OpenUp123!
 *   npm run set-password -- --all OpenUp123!     (every seeded account)
 *
 * Also used to repair the seed data: the hash committed in seed.sql was
 * wrong, so run --all once to give every test account a working password.
 */

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\nUsage:');
  console.log('  npm run set-password -- <email> <password>');
  console.log('  npm run set-password -- --all <password>\n');
  process.exit(1);
}

const [target, password] = args;

if (password.length < 8) {
  console.log('\nPassword must be at least 8 characters — the API enforces this too.\n');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const hash = await bcrypt.hash(password, 10);

  const { rows } = target === '--all'
    ? await pool.query('UPDATE "user" SET password = $1 RETURNING email, role', [hash])
    : await pool.query(
        'UPDATE "user" SET password = $1 WHERE email = $2 RETURNING email, role',
        [hash, target]
      );

  if (!rows.length) {
    console.log(`\nNo account found for ${target}.`);
    const { rows: all } = await pool.query('SELECT email FROM "user" ORDER BY user_id');
    console.log('Accounts in the database:');
    all.forEach((r) => console.log(`  ${r.email}`));
    console.log();
    process.exit(1);
  }

  console.log(`\nPassword updated for ${rows.length} account(s):`);
  rows.forEach((r) => console.log(`  ${r.email}  (${r.role})`));
  console.log('\nSign in at http://localhost:5173\n');
} catch (err) {
  console.error(`\nFailed: ${err.message}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
