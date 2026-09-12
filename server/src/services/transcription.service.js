/**
 * Speech-to-text for the Voice Journal.
 *
 * Primary provider is Google Cloud Speech-to-Text V2 with the chirp_2
 * model, chosen over Whisper for one reason that matters more than raw
 * accuracy: chirp_2 supports model adaptation for ceb-PH, so the Bisaya
 * crisis phrases the safety floor depends on can be boosted directly in
 * the recogniser. Whisper offers no equivalent, which means a garbled
 * disclosure never reaches the keyword check at all.
 *
 * Chirp serves Cebuano only from asia-southeast1. That happens to be the
 * nearest region to Cebu, so latency is low.
 *
 * STT_PROVIDER selects: google | openai | mock
 */

import { boostPhrases } from './crisis-vocabulary.js';

const LOCATION = 'asia-southeast1';

export const LANGUAGES = {
  en:  { label: 'English',  google: 'en-PH',  whisper: 'en',  quality: 'good' },
  tl:  { label: 'Filipino', google: 'fil-PH', whisper: 'tl',  quality: 'good' },
  ceb: { label: 'Bisaya',   google: 'ceb-PH', whisper: 'ceb', quality: 'fair' },
};

const MOCK_TRANSCRIPTS = [
  'Kapoy kaayo ako karon. Daghan kaayo problema sa trabaho ug wala koy makastorya.',
  'I have been feeling a bit better this week. I managed to sleep properly for three nights.',
  'Dili na ko gusto mabuhi. Murag wala nay pulos tanan.',
  'Today was okay. I went for a walk near the seawall and it helped clear my head a little.',
];

export const provider = () => {
  const p = (process.env.STT_PROVIDER || '').toLowerCase();
  if (p === 'mock' || process.env.MOCK_AI === 'true') return 'mock';
  if (p === 'google' && process.env.GOOGLE_CLOUD_PROJECT) return 'google';
  if (p === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  // Nothing explicitly set: prefer whichever is configured, and fall back
  // to mock rather than failing a resident's recording on credentials.
  if (process.env.GOOGLE_CLOUD_PROJECT) return 'google';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'mock';
};

export const isMocked = () => provider() === 'mock';

// ---------------------------------------------------------------------
// Google Cloud Speech-to-Text V2 (chirp_2)
// ---------------------------------------------------------------------

let speechClient = null;

/** Lazily constructed so the module imports fine without credentials. */
async function getSpeechClient() {
  if (speechClient) return speechClient;
  const { SpeechClient } = (await import('@google-cloud/speech')).v2;
  speechClient = new SpeechClient({
    apiEndpoint: `${LOCATION}-speech.googleapis.com`,
  });
  return speechClient;
}

function buildConfig(languageCode, withAdaptation) {
  const config = {
    // Lets Google detect container and codec. MediaRecorder produces
    // WebM/Opus on Chrome and MP4/AAC on Safari, so hardcoding either
    // breaks half the browsers.
    autoDecodingConfig: {},
    model: 'chirp_2',
    languageCodes: [languageCode],
    features: {
      enableAutomaticPunctuation: true,
      enableWordConfidence: true,
    },
  };

  if (withAdaptation) {
    config.adaptation = {
      phraseSets: [{ inlinePhraseSet: { phrases: boostPhrases() } }],
    };
  }

  return config;
}

async function transcribeGoogle(buffer, language) {
  const client = await getSpeechClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const languageCode = LANGUAGES[language]?.google ?? 'en-PH';

  // '_' is the implicit recognizer: no resource to create up front.
  const recognizer = `projects/${projectId}/locations/${LOCATION}/recognizers/_`;

  const run = async (withAdaptation) => {
    const [response] = await client.recognize({
      recognizer,
      config: buildConfig(languageCode, withAdaptation),
      content: buffer,
    });
    return response;
  };

  let response;
  let adaptationUsed = true;
  try {
    response = await run(true);
  } catch (err) {
    // Adaptation support varies by language and region. If the API refuses
    // the phrase set, transcribe without it rather than losing the entry.
    const retryable = /adaptation|phrase|INVALID_ARGUMENT/i.test(err.message || '');
    if (!retryable) throw err;
    console.warn('Phrase adaptation rejected, retrying without it:', err.message);
    adaptationUsed = false;
    response = await run(false);
  }

  const results = response.results ?? [];
  const transcript = results
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Average word confidence, used to warn the resident when the
  // transcript is probably wrong.
  const words = results.flatMap((r) => r.alternatives?.[0]?.words ?? []);
  const scores = words.map((w) => w.confidence).filter((c) => typeof c === 'number');
  const confidence = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : results[0]?.alternatives?.[0]?.confidence ?? null;

  if (!transcript)
    throw new Error('The recording produced no speech. It may be silent or too quiet.');

  return { transcript, confidence, provider: 'google', adaptation: adaptationUsed };
}

// ---------------------------------------------------------------------
// OpenAI Whisper (fallback)
// ---------------------------------------------------------------------

async function transcribeWhisper(buffer, filename, mimetype, language) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  form.append('model', 'whisper-1');
  form.append('language', LANGUAGES[language]?.whisper ?? 'en');
  form.append('prompt', 'A personal mental health journal entry spoken aloud.');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const transcript = (data.text || '').trim();
  if (!transcript)
    throw new Error('The recording produced no speech. It may be silent or too quiet.');

  // Whisper exposes no per-word confidence.
  return { transcript, confidence: null, provider: 'openai', adaptation: false };
}

// ---------------------------------------------------------------------

/**
 * @returns {Promise<{transcript, confidence, provider, adaptation, mocked}>}
 */
export async function transcribe(buffer, filename, mimetype, language = 'en') {
  const active = provider();

  if (active === 'mock') {
    const pick = MOCK_TRANSCRIPTS[Math.floor(Math.random() * MOCK_TRANSCRIPTS.length)];
    await new Promise((r) => setTimeout(r, 400));
    return {
      transcript: pick, confidence: 0.9, provider: 'mock',
      adaptation: false, mocked: true,
    };
  }

  if (active === 'google') {
    try {
      return { ...(await transcribeGoogle(buffer, language)), mocked: false };
    } catch (err) {
      // A configuration or quota problem should not cost the resident
      // their entry when a second provider is available.
      if (process.env.OPENAI_API_KEY) {
        console.warn('Google transcription failed, using Whisper:', err.message);
        return {
          ...(await transcribeWhisper(buffer, filename, mimetype, language)),
          mocked: false,
        };
      }
      throw err;
    }
  }

  return {
    ...(await transcribeWhisper(buffer, filename, mimetype, language)),
    mocked: false,
  };
}
