import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  uploadJournalAudio, signJournalUrl, deleteJournalAudio,
} from '../config/storage.js';
import { transcribe, LANGUAGES } from '../services/transcription.service.js';
import { analyse } from '../services/emotion.service.js';
import { shouldEscalate, raiseCrisisAlert, getHotlines } from '../services/crisis.service.js';

const router = Router();
router.use(requireAuth, requireRole('resident'));

// MediaRecorder produces webm on Chrome and mp4 on Safari.
const ALLOWED = [
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/wav', 'video/webm',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.some((t) => file.mimetype.startsWith(t.split(';')[0]))
      ? cb(null, true)
      : cb(new ApiError(400, 'That audio format is not supported.')),
});

/** Which languages the recorder offers, and how well each transcribes. */
router.get('/languages', (_req, res) =>
  res.json({
    languages: Object.entries(LANGUAGES).map(([code, v]) => ({ code, ...v })),
  })
);

/** Crisis resources, always reachable regardless of any analysis. */
router.get(
  '/support',
  asyncHandler(async (_req, res) => res.json({ hotlines: await getHotlines() }))
);

// ---------------------------------------------------------------------
// Module: Voice Journal
//   1. Record Voice Diary        (POST /)
//   2. Speech-to-Text            (inside POST /)
//   3. Emotion Analysis          (inside POST /)
//   4. View Emotion Trends       (GET /trends)
//   5. Send Crisis Alert         (inside POST /)
// ---------------------------------------------------------------------

/**
 * The whole pipeline in one request.
 *
 * Runs synchronously, which is a deliberate trade: a resident who has just
 * recorded something difficult should get a response, not a spinner and a
 * promise to check back. A three-minute entry takes roughly five to eight
 * seconds. If entries get long enough for that to hurt, the `status`
 * column already supports moving this to a background worker without any
 * change to the interface.
 */
router.post(
  '/',
  upload.single('audio'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No recording was received.');

    const { language, duration_sec } = z
      .object({
        language: z.enum(['en', 'tl', 'ceb']).default('en'),
        duration_sec: z.coerce.number().int().min(1).max(1800).optional(),
      })
      .parse(req.body);

    const userId = req.user.user_id;

    // Stage 1 — store the audio and the row, so a later failure still
    // leaves the resident with their recording rather than nothing.
    const audioPath = await uploadJournalAudio(userId, req.file);

    const { rows } = await query(
      `INSERT INTO voice_journal
         (user_id, audio_url, language, duration_sec, status, transcript, emotion_result)
       VALUES ($1, $2, $3, $4, 'transcribing', '', 'neutral')
       RETURNING journal_id`,
      [userId, audioPath, language, duration_sec ?? null]
    );
    const journalId = rows[0].journal_id;

    try {
      // Stage 2 — transcribe.
      const {
        transcript, confidence, provider: sttProvider, mocked: mockedStt,
      } = await transcribe(
        req.file.buffer, req.file.originalname || 'entry.webm', req.file.mimetype, language
      );

      await query(
        `UPDATE voice_journal
            SET transcript = $2, transcript_confidence = $3, status = 'analyzing'
          WHERE journal_id = $1`,
        [journalId, transcript, confidence]
      );

      // Stage 3 — emotion and risk.
      const a = await analyse(transcript);

      await query(
        `UPDATE voice_journal
            SET emotion_result = $2, emotion_scores = $3, ai_reflection = $4,
                risk_level = $5, risk_score = $6, status = 'ready'
          WHERE journal_id = $1`,
        [journalId, a.emotion, a.scores, a.reflection, a.risk_level, a.risk_score]
      );

      // Stage 4 — escalate if warranted.
      let crisis = null;
      if (await shouldEscalate(a)) {
        crisis = await raiseCrisisAlert({
          userId,
          source: 'voice_journal',
          sourceId: journalId,
          riskLevel: a.risk_level,
        });
      }

      res.status(201).json({
        journal: {
          journal_id: journalId,
          transcript,
          emotion_result: a.emotion,
          emotion_scores: a.scores,
          ai_reflection: a.reflection,
          risk_level: a.risk_level,
          language,
          status: 'ready',
          transcript_confidence: confidence,
        },
        // The client shows these whenever they are present. A resident in
        // crisis should not have to navigate anywhere to find a number.
        crisis: crisis
          ? {
              hotlines: crisis.hotlines,
              contact_alerted: crisis.contact_alerted,
              message:
                'What you wrote suggests you are carrying something heavy right now. A psychologist has been alerted, and you can reach someone immediately using the numbers below.',
            }
          : null,
        mocked: mockedStt || a.mocked,
        stt_provider: sttProvider,
        // Below roughly 0.7 the transcript is usually wrong somewhere. Say
        // so rather than presenting a guess as what the resident said.
        low_confidence: typeof confidence === 'number' && confidence < 0.7,
      });
    } catch (err) {
      await query(
        `UPDATE voice_journal SET status = 'failed', error_detail = $2
          WHERE journal_id = $1`,
        [journalId, String(err.message).slice(0, 500)]
      );
      throw ApiError.badRequest(
        `Your recording was saved but could not be processed. ${err.message}`
      );
    }
  })
);

/** History. Never returns another resident's entries. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { rows } = await query(
      `SELECT journal_id, transcript, transcript_confidence, emotion_result,
              emotion_scores, ai_reflection, risk_level, risk_score, language,
              duration_sec, status, error_detail, created_at
         FROM voice_journal
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.user.user_id, limit]
    );
    res.json({ entries: rows });
  })
);

/** 4. View Emotion Trends. */
router.get(
  '/trends',
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 180);

    const [daily, emotions] = await Promise.all([
      query(
        `SELECT entry_date, entries, avg_risk, dominant_emotion
           FROM v_journal_emotion_daily
          WHERE user_id = $1 AND entry_date >= CURRENT_DATE - $2::int
          ORDER BY entry_date`,
        [req.user.user_id, days]
      ),
      query(
        `SELECT emotion_result, COUNT(*)::int AS n
           FROM voice_journal
          WHERE user_id = $1 AND status = 'ready'
            AND created_at >= now() - ($2::int || ' days')::interval
          GROUP BY emotion_result
          ORDER BY n DESC`,
        [req.user.user_id, days]
      ),
    ]);

    res.json({ daily: daily.rows, emotions: emotions.rows });
  })
);

/** Playback, via a short-lived signed URL. */
router.get(
  '/:id/audio',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT audio_url FROM voice_journal WHERE journal_id = $1 AND user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) throw ApiError.notFound('No such entry.');
    if (!rows[0].audio_url) throw ApiError.notFound('This entry has no audio.');
    res.json({ audio_url: await signJournalUrl(rows[0].audio_url) });
  })
);

/**
 * Delete an entry.
 *
 * Any crisis alert already raised stays. The resident owns their journal,
 * but deleting the recording should not silently retract a request for
 * help that a psychologist may already be acting on.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `DELETE FROM voice_journal
        WHERE journal_id = $1 AND user_id = $2
        RETURNING audio_url`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) throw ApiError.notFound('No such entry.');
    if (rows[0].audio_url) deleteJournalAudio(rows[0].audio_url).catch(() => {});
    res.json({ ok: true });
  })
);

export default router;
