/**
 * Emotion and risk analysis for a journal transcript.
 *
 * Two layers, deliberately:
 *
 *  1. A language model classifies emotion and estimates risk, and writes a
 *     short reflection back to the resident.
 *
 *  2. A deterministic check runs over the same transcript and can only ever
 *     raise the risk level, never lower it. A model that returns malformed
 *     JSON, times out, or quietly under-rates a clear statement of intent
 *     must not be the only thing standing between a resident and an
 *     escalation. The floor is crude on purpose: it trades false positives
 *     for never missing an explicit disclosure.
 *
 * Set MOCK_AI=true to develop without API calls.
 */

import { SEVERE_PHRASES, HIGH_PHRASES } from './crisis-vocabulary.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

export const RISK_LEVELS = ['low', 'moderate', 'high', 'severe'];
const rank = (level) => RISK_LEVELS.indexOf(level);

export const isMocked = () =>
  process.env.MOCK_AI === 'true' || !process.env.OPENAI_API_KEY;

/** Returns the minimum risk level the transcript must be treated as. */
function deterministicFloor(transcript) {
  const t = ` ${transcript.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ')} `;
  const hit = (list) => list.find((m) => t.includes(` ${m} `) || t.includes(m));

  const severe = hit(SEVERE_PHRASES);
  if (severe) return { level: 'severe', matched: severe };

  const high = hit(HIGH_PHRASES);
  if (high) return { level: 'high', matched: high };

  return { level: 'low', matched: null };
}

const SYSTEM_PROMPT = `You analyse short mental health journal entries from residents of Cebu City, Philippines. Entries may mix English, Filipino and Bisaya.

Return ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "emotion": one of "hopeful","calm","neutral","tired","anxious","sad","angry","distressed",
  "scores": { "valence": -1.0 to 1.0, "arousal": 0.0 to 1.0 },
  "risk_level": one of "low","moderate","high","severe",
  "risk_score": 0.0 to 1.0,
  "reflection": 2 to 3 sentences addressed to the writer
}

Risk guidance:
- "severe": states intent to end their life or cause serious self-harm.
- "high": expresses hopelessness, feeling trapped, or being unable to continue, without stated intent.
- "moderate": sustained distress, isolation, or despair.
- "low": ordinary difficulty, frustration, tiredness, or a neutral or positive entry.

The reflection must acknowledge what the person actually said in their own terms. Do not diagnose. Do not give clinical instructions. Do not tell them to seek professional help, as the application handles that separately. Warm and plain, not clinical. Write in the same language the entry mostly used.`;

const MOCK_BY_KEYWORD = (transcript) => {
  const floor = deterministicFloor(transcript);
  if (floor.level === 'severe')
    return {
      emotion: 'distressed', scores: { valence: -0.9, arousal: 0.7 },
      risk_level: 'severe', risk_score: 0.95,
      reflection: 'Nabasa nako nga bug-at kaayo ang imong gibati karon, ug daghan kaayo ang imong giatubang nga wala kay kaistorya. Salamat kay giasoy nimo kini.',
    };
  if (floor.level === 'high')
    return {
      emotion: 'sad', scores: { valence: -0.7, arousal: 0.4 },
      risk_level: 'high', risk_score: 0.72,
      reflection: 'Murag kapoy na kaayo ka ug wala kay makita nga kalingkawasan. Lisod kaayo na nga dag-om.',
    };
  return {
    emotion: 'neutral', scores: { valence: 0.1, arousal: 0.3 },
    risk_level: 'low', risk_score: 0.12,
    reflection: 'Thanks for taking a moment to record this. Noticing how a day actually went is a real thing to do.',
  };
};

/**
 * @param {string} transcript
 * @returns {Promise<{emotion,scores,risk_level,risk_score,reflection,floor_applied,mocked}>}
 */
export async function analyse(transcript) {
  const floor = deterministicFloor(transcript);

  let result;
  let mocked = false;

  if (isMocked()) {
    await new Promise((r) => setTimeout(r, 300));
    result = MOCK_BY_KEYWORD(transcript);
    mocked = true;
  } else {
    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: transcript.slice(0, 6000) },
          ],
        }),
      });

      if (!res.ok) throw new Error(`analysis failed (${res.status})`);
      const data = await res.json();
      result = JSON.parse(data.choices[0].message.content);
    } catch (err) {
      // Analysis is best-effort; the safety floor is not. Fall back to a
      // conservative result derived from the floor rather than failing the
      // whole entry and losing the escalation.
      console.error('Emotion analysis failed, using deterministic fallback:', err.message);
      result = MOCK_BY_KEYWORD(transcript);
      result.reflection =
        'Your entry was saved, but the reflection could not be generated this time.';
    }
  }

  // Normalise, since a model can return anything.
  let level = RISK_LEVELS.includes(result.risk_level) ? result.risk_level : 'low';
  let score = Number.isFinite(Number(result.risk_score))
    ? Math.min(1, Math.max(0, Number(result.risk_score)))
    : 0.1;

  // The floor can raise but never lower.
  const floorApplied = rank(floor.level) > rank(level);
  if (floorApplied) {
    level = floor.level;
    score = Math.max(score, floor.level === 'severe' ? 0.9 : 0.7);
  }

  return {
    emotion: result.emotion || 'neutral',
    scores: result.scores || {},
    risk_level: level,
    risk_score: score,
    reflection: result.reflection || '',
    floor_applied: floorApplied,
    matched_marker: floorApplied ? floor.matched : null,
    mocked,
  };
}
