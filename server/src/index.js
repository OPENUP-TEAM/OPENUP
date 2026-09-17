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
import adminRoutes from './routes/admin.routes.js';
import psychologistSelfRoutes from './routes/psychologist-self.routes.js';
import journalRoutes from './routes/journal.routes.js';
import residentSelfRoutes from './routes/resident-self.routes.js';
import sessionRoutes from './routes/session.routes.js';
import chatRoutes from './routes/chat.routes.js';
import aiRoutes from './routes/ai.routes.js';
import creditsRoutes from './routes/credits.routes.js';
import groupRoutes from './routes/group.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import resourceRoutes from './routes/resource.routes.js';
import assessmentRoutes from './routes/assessment.routes.js';
import supportRoutes from './routes/support.routes.js';
import usersRoutes from './routes/users.routes.js';
import testimonialRoutes from './routes/testimonial.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import governanceRoutes from './routes/governance.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import navRoutes from './routes/nav.routes.js';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: process.env.CLIENT_ORIGIN, credentials: true },
});

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

/**
 * Throttle credential guessing, and nothing else.
 *
 * This used to cover all of /api/auth, which includes /auth/me — called on
 * every page load to restore a session. Ordinary use burned the quota and
 * then locked the person out of signing back in. Only the two endpoints
 * that accept a password are limited.
 *
 * skipSuccessfulRequests means a person switching between test accounts is
 * never blocked; only repeated failures count, which is what the limit is
 * actually for.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.',
  },
});

app.use('/api/auth/login', credentialLimiter);
app.use('/api/auth/register', credentialLimiter);
app.use('/api/auth/change-password', credentialLimiter);
// Reset endpoints are the other way someone gets into an account, so they
// are throttled too. Not skipSuccessful here: a successful reset request
// still costs an email and should not be repeatable without limit.
app.use('/api/auth/forgot-password', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in an hour.' },
}));
app.use('/api/auth/reset-password', credentialLimiter);

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
app.use('/api/admin', adminRoutes);
app.use('/api/me/psychologist', psychologistSelfRoutes);
app.use('/api/journals', journalRoutes);
app.use('/api/me', residentSelfRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/companion', aiRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/community', testimonialRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/nav-counts', navRoutes);

// Multer rejects oversized or wrong-type uploads with its own error class.
app.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'That file is larger than 8 MB.' });
  if (err?.code === 'LIMIT_FILE_COUNT')
    return res.status(400).json({ error: 'Upload one file at a time.' });
  next(err);
});

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

// The journal pipeline (upload, transcribe, analyse) can take several
// seconds on a long entry. Node's default 5s headers timeout would abort it.
server.requestTimeout = 120_000;
server.headersTimeout = 125_000;

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`OpenUp API listening on http://localhost:${port}`));
