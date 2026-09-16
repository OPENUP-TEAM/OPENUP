/**
 * Who is connected right now.
 *
 * Used to answer "is there a psychologist available at this moment" honestly.
 * A crisis panel that says "connect to a psychologist" when nobody is online
 * sends someone in distress into an empty room, which is worse than
 * telling them plainly to call a hotline instead.
 *
 * Presence lives in memory on purpose. It is true only for this server
 * process and is meant to be: a stale row in a database claiming someone
 * is online is exactly the lie this is trying to avoid. If the API is ever
 * run as more than one process, this needs Redis.
 */

// userId -> number of open sockets (a person may have two tabs)
const connections = new Map();

export function markOnline(userId) {
  connections.set(userId, (connections.get(userId) ?? 0) + 1);
}

export function markOffline(userId) {
  const n = (connections.get(userId) ?? 1) - 1;
  if (n <= 0) connections.delete(userId);
  else connections.set(userId, n);
}

export const isOnline = (userId) => connections.has(userId);

export const onlineUserIds = () => [...connections.keys()];

export const onlineCount = () => connections.size;
