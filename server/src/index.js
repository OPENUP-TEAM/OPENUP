import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';
import { ZodError } from 'zod';

import { pool } from './config/db.js';
import { registerSockets } from './sockets/index.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import barangayRoutes from './routes/barangay.routes.js';
import moodRoutes from './routes/mood.routes.js';
import psychologistRoutes from './routes/psychologist.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import lguRoutes from './routes/lgu.routes.js';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: process.env.CLIENT_ORIGIN, credentials: true },
});

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// Sign-in and sign-up are the endpoints worth throttling.
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/barangays', barangayRoutes);
app.use('/api/moods', moodRoutes);
app.use('/api/psychologists', psychologistRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/lgu', lguRoutes);

// Turn Zod failures into readable 400s before the generic handler sees them.
app.use((err, _req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Check the highlighted fields.',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  next(err);
});

app.use(notFound);
app.use(errorHandler);

registerSockets(io);

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`OpenUp API listening on http://localhost:${port}`));
