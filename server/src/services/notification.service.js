import { query } from '../config/db.js';

let io = null;
export const bindIo = (server) => { io = server; };

/**
 * Insert a notification and push it live if the user has a socket open.
 * Pass a transaction client as `db` when called inside withTransaction.
 */
export async function notify(db, userId, message, type = 'system', link = null) {
  const runner = db?.query ? db : { query };
  const { rows } = await runner.query(
    `INSERT INTO notification (user_id, message, type, link)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, message, type, link]
  );
  io?.to(`user:${userId}`).emit('notification:new', rows[0]);
  return rows[0];
}
