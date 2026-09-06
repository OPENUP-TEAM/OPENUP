import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { bindIo } from '../services/notification.service.js';

/**
 * Real-time layer. Two things run over it:
 *   - Anonymous Chat (send / receive / typing)
 *   - Live notification delivery
 *
 * Every socket joins `user:<id>` so the server can push to a person
 * regardless of which page they have open.
 */
export function registerSockets(io) {
  bindIo(io);

  // Handshake auth: the client passes the same JWT it uses for REST.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await query(
        `SELECT user_id, name, role, display_alias FROM "user"
          WHERE user_id = $1 AND status = 'active'`,
        [payload.sub]
      );
      if (!rows.length) return next(new Error('unauthorized'));
      socket.user = rows[0];
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.user_id}`);

    // Only the two participants may join a conversation room.
    socket.on('chat:join', async (conversationId, ack) => {
      const { rows } = await query(
        `SELECT c.conversation_id
           FROM conversation c
           LEFT JOIN psychologist p ON p.psychologist_id = c.psychologist_id
          WHERE c.conversation_id = $1
            AND (c.resident_id = $2 OR p.user_id = $2)`,
        [conversationId, socket.user.user_id]
      );
      if (!rows.length) return ack?.({ ok: false, error: 'No access to that conversation.' });
      socket.join(`conversation:${conversationId}`);
      ack?.({ ok: true });
    });

    // Module: Anonymous Chat — 1. Send Message / 2. Receive Message
    socket.on('chat:send', async ({ conversationId, content }, ack) => {
      if (!content?.trim()) return ack?.({ ok: false, error: 'Message is empty.' });
      if (!socket.rooms.has(`conversation:${conversationId}`))
        return ack?.({ ok: false, error: 'Join the conversation first.' });

      const { rows } = await query(
        `INSERT INTO message (conversation_id, sender_id, content)
         VALUES ($1,$2,$3) RETURNING *`,
        [conversationId, socket.user.user_id, content.trim()]
      );

      const convo = await query(
        'SELECT is_anonymous FROM conversation WHERE conversation_id = $1',
        [conversationId]
      );

      // Module: Anonymous Chat — 3. Toggle Anonymous Mode.
      // The resident's real name never leaves the server while anonymous.
      const anonymous = convo.rows[0]?.is_anonymous && socket.user.role === 'resident';
      const senderName = anonymous
        ? socket.user.display_alias || 'Anonymous resident'
        : socket.user.name;

      io.to(`conversation:${conversationId}`).emit('chat:message', {
        ...rows[0],
        sender_name: senderName,
        sender_role: socket.user.role,
      });
      ack?.({ ok: true, message: rows[0] });
    });

    socket.on('chat:typing', ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit('chat:typing', {
        userId: socket.user.user_id,
        isTyping,
      });
    });

    socket.on('disconnect', () => {
      // Rooms are cleaned up by Socket.IO automatically.
    });
  });
}
