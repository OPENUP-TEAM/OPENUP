import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Supabase pooler requires SSL. rejectUnauthorized:false is fine for the
// pooler's certificate chain; swap in the CA bundle for production.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const query = (text, params) => pool.query(text, params);

/** Run several statements in one transaction. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
