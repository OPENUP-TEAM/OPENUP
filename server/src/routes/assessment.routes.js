import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { asyncHandler, ApiError } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { INSTRUMENTS, scoreAssessment, listInstruments } from '../services/assessment.service.js';
import { raiseCrisisAlert, getHotlines } from '../services/crisis.service.js';

const router = Router();
router.use(requireAuth, requireRole('resident'));

// ---------------------------------------------------------------------
// Module: Mental Health Assessment (Noe Tobes)
//   1. Start Assessment
//   2. Answer Check-in Questions
//   3. View Results
// ---------------------------------------------------------------------

/** 1. Start Assessment — what is available. */
router.get('/', (_req, res) => res.json({ instruments: listInstruments() }));

/** 2. Answer Check-in Questions — the questions themselves. */
router.get(
  '/:instrument',
  asyncHandler(async (req, res) => {
    const instrument = INSTRUMENTS[req.params.instrument];
    if (!instrument) throw ApiError.notFound('No such assessment.');

    const { bands, safety_item_index, ...safe } = instrument;
    res.json({ instrument: safe });
  })
);

/**
 * Submit answers.
 *
 * Two things can trigger follow-up: a high total, or the PHQ-9 safety item
 * answered above zero. The second matters most. Someone can answer "not at
 * all" to eight items and still endorse thoughts of being better off dead,
 * producing a total in the mild band. Scoring on the total alone would let
 * that pass silently, which is the single worst failure this module could
 * have.
 */
router.post(
  '/:instrument/submit',
  asyncHandler(async (req, res) => {
    const instrument = INSTRUMENTS[req.params.instrument];
    if (!instrument) throw ApiError.notFound('No such assessment.');

    const { answers } = z
      .object({ answers: z.array(z.coerce.number().int().min(0).max(3)) })
      .parse(req.body);

    let scored;
    try {
      scored = scoreAssessment(instrument.key, answers);
    } catch (err) {
      throw ApiError.badRequest(err.message);
    }

    const { rows } = await query(
      `INSERT INTO assessment
         (user_id, instrument, score, max_score, result, severity, answers, flagged_item)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING assessment_id, taken_at`,
      [req.user.user_id, scored.instrument, scored.score, scored.max_score,
       scored.result, scored.severity, JSON.stringify(answers), scored.flagged_item]
    );

    let crisis = null;
    if (scored.flagged_item || scored.severity === 'severe') {
      const alert = await raiseCrisisAlert({
        userId: req.user.user_id,
        source: 'assessment',
        sourceId: rows[0].assessment_id,
        riskLevel: scored.flagged_item ? 'severe' : 'high',
      });
      crisis = {
        hotlines: alert.hotlines,
        contact_alerted: alert.contact_alerted,
        message: scored.flagged_item
          ? 'One of your answers suggests you have been having thoughts of hurting yourself. That is worth taking seriously, and you do not have to sit with it alone.'
          : 'Your answers suggest you have been struggling a great deal lately. A psychologist has been notified and you can reach someone now.',
      };
    }

    res.status(201).json({
      assessment_id: rows[0].assessment_id,
      taken_at: rows[0].taken_at,
      ...scored,
      // Only offered when it is actually the next sensible step.
      suggest_booking: scored.needs_followup,
      crisis,
    });
  })
);

/** 3. View Results — history with trend. */
router.get(
  '/:instrument/history',
  asyncHandler(async (req, res) => {
    if (!INSTRUMENTS[req.params.instrument])
      throw ApiError.notFound('No such assessment.');

    const { rows } = await query(
      `SELECT assessment_id, score, max_score, result, severity,
              flagged_item, taken_at
         FROM assessment
        WHERE user_id = $1 AND instrument = $2
        ORDER BY taken_at DESC
        LIMIT 20`,
      [req.user.user_id, req.params.instrument]
    );

    res.json({
      history: rows,
      // Direction of travel is more useful to a resident than any single score.
      trend:
        rows.length < 2
          ? null
          : rows[0].score < rows[1].score
            ? 'improving'
            : rows[0].score > rows[1].score
              ? 'worse'
              : 'unchanged',
    });
  })
);

/** Hotlines, reachable without completing anything. */
router.get(
  '/support/hotlines',
  asyncHandler(async (_req, res) => res.json({ hotlines: await getHotlines() }))
);

export default router;
