import { SEVERE_PHRASES, HIGH_PHRASES } from './crisis-vocabulary.js';

/**
 * The AI Crisis Companion.
 *
 * This is the highest-consequence path in the system, so the design is
 * deliberately conservative:
 *
 *  - The companion is a listener, not a clinician. It does not diagnose,
 *    prescribe coping techniques, or offer therapy. It reflects what the
 *    person said and helps them feel heard until a human is available.
 *  - Risk is scored on every message, and the same deterministic floor
 *    used by the Voice Journal can raise it but never lower it.
 *  - The companion never becomes a substitute for a person. Once risk is
 *    high, the interface puts a human and a phone number in front of the
 *    resident rather than continuing the conversation indefinitely.
 *
 * Set MOCK_AI=true to develop without API calls.
 */

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

export const isMocked = () =>
  process.env.MOCK_AI === 'true' || !process.env.OPENAI_API_KEY;

const LANGUAGE_NOTE = {
  en: 'Reply in English.',
  tl: 'Reply in Filipino.',
  ceb: 'Reply in Bisaya (Cebuano).',
};

const SYSTEM_PROMPT = (language) => `You are a companion inside OpenUp, a mental wellness service for residents of Cebu City, Philippines. Someone has opened this chat because they are struggling. You may be the first thing they have told.

Your job is to listen and to keep them company until a person can reach them. You are not a therapist and you must never present yourself as one.

Do:
- Respond to what they actually said, in their own terms.
- Ask one gentle, open question at a time if it helps them keep talking.
- Acknowledge how heavy something sounds without rushing to fix it.
- Keep replies short. Two to four sentences. This is a conversation, not an article.
- ${LANGUAGE_NOTE[language] ?? LANGUAGE_NOTE.en} Match their register: if they code-switch, you may too.

Never:
- Diagnose, or name a condition they might have.
- Give clinical instructions, treatment advice, or therapy exercises.
- Discuss or ask about methods of self-harm, in any framing.
- Claim to be human, a counselor, or a licensed professional.
- Promise confidentiality you cannot guarantee, or promise everything will be fine.
- Tell them to seek professional help as a way to close the conversation. The application surfaces counselors and hotlines separately, and being redirected reads as dismissal.

After your reply, assess risk in the person's most recent message:
- "severe": states intent to end their life or cause serious self-harm.
- "high": hopelessness, feeling trapped, or unable to continue, without stated intent.
- "moderate": sustained distress, isolation, or despair.
- "low": ordinary difficulty, frustration, tiredness, or a neutral entry.

Return ONLY a JSON object, no markdown fences:
{ "reply": "your message to them", "risk_level": "low|moderate|high|severe", "risk_score": 0.0 to 1.0 }`;

const RISK_LEVELS = ['low', 'moderate', 'high', 'severe'];
const rank = (l) => RISK_LEVELS.indexOf(l);

/** Same floor as the Voice Journal, over the same shared vocabulary. */
function deterministicFloor(text) {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ')} `;
  const hit = (list) => list.find((m) => t.includes(` ${m} `) || t.includes(m));
  if (hit(SEVERE_PHRASES)) return 'severe';
  if (hit(HIGH_PHRASES)) return 'high';
  return 'low';
}

/**
 * Mock replies.
 *
 * Several per risk level, rotated by turn, because a companion that says
 * the same sentence three times reads as broken — and mock mode is what
 * gets demonstrated when no API key is configured.
 */
const MOCK_REPLIES = {
  severe: {
    en: [
      'Thank you for telling me that. What you are carrying sounds unbearably heavy, and I do not want you to be alone with it right now.',
      'I am glad you said it out loud. That is a lot to be holding, and you should not have to hold it by yourself tonight.',
      'I hear you, and I am staying right here. Is there anyone nearby you could sit with while we talk?',
    ],
    tl: [
      'Salamat sa pagsasabi sa akin. Napakabigat ng dala mo, at ayokong mag-isa ka ngayon.',
      'Mabuti at nasabi mo. Napakabigat niyan, at hindi mo dapat buhatin mag-isa ngayong gabi.',
      'Naririnig kita, at nandito lang ako. May kasama ka ba diyan ngayon?',
    ],
    ceb: [
      'Salamat kay giasoy nimo nako. Bug-at kaayo ang imong gidala, ug dili nako gusto nga mag-inusara ka karon.',
      'Maayo kay imong gisulti. Bug-at kaayo na, ug dili unta ka mag-inusara karong gabhiona.',
      'Nadungog tika, ug ania ra ko. Naa bay tawo diha nimo karon nga makatampad nimo?',
    ],
  },
  high: {
    en: [
      'That sounds exhausting, like you have been holding it on your own for a long time. What has today been like?',
      'It sounds like you have run out of room. How long has it felt this way?',
      'That is a heavy thing to carry quietly. What has been the hardest part of it?',
    ],
    tl: [
      'Mukhang nakakapagod iyan, na parang matagal mo nang binubuhat mag-isa. Kumusta ang araw mo ngayon?',
      'Parang wala ka nang espasyo. Gaano na katagal ganito ang pakiramdam mo?',
      'Mabigat iyang dinadala nang tahimik. Ano ang pinakamahirap doon?',
    ],
    ceb: [
      'Murag makakapoy kaayo na, nga dugay na nimo gidala nga ikaw ra usa. Kumusta imong adlaw karon?',
      'Murag wala na kay kaluagan. Dugay na ba ka ingon ani mobati?',
      'Bug-at kaayo dalhon nga hilom ra. Unsa ang labing lisod ana?',
    ],
  },
  moderate: {
    en: [
      'I hear you. That is a lot to sit with. What part of it is weighing on you most?',
      'Thanks for saying that out loud. What has been going on?',
      'That sounds hard. Tell me more about it, if you want to.',
      'I am listening. When did it start feeling like this?',
      'That makes sense. What would help most right now, even a little?',
    ],
    tl: [
      'Naririnig kita. Marami iyang dinadala. Alin doon ang pinakamabigat sa iyo?',
      'Salamat sa pagsasabi. Ano ang nangyayari?',
      'Mukhang mahirap iyan. Ikuwento mo pa, kung gusto mo.',
      'Nakikinig ako. Kailan nagsimula ang ganitong pakiramdam?',
      'Naiintindihan ko. Ano kaya ang makakatulong ngayon, kahit kaunti?',
    ],
    ceb: [
      'Nadungog tika. Daghan kaayo na. Unsa ang labing bug-at nimo karon?',
      'Salamat sa pagsulti. Unsa may nahitabo?',
      'Murag lisod na. Isulti pa, kung gusto nimo.',
      'Naminaw ko. Kanus-a nagsugod ang ingon ani nga pagbati?',
      'Sabot ko. Unsa kaha ang makatabang karon, bisan gamay?',
    ],
  },
  low: {
    en: [
      'Thanks for saying that. I am here if you want to keep going.',
      'Got it. What else is on your mind?',
      'That is good to hear. How has the rest of the week been?',
      'Okay. Take your time, there is no rush here.',
    ],
    tl: [
      'Salamat sa pagsasabi. Nandito lang ako kung gusto mong magpatuloy.',
      'Sige. Ano pa ang nasa isip mo?',
      'Mabuti naman. Kumusta ang natitirang linggo mo?',
      'Okay. Dahan-dahan lang, walang nagmamadali dito.',
    ],
    ceb: [
      'Salamat sa pagsulti. Ania ra ko kung gusto nimo magpadayon.',
      'Sige. Unsa pa may naa sa imong hunahuna?',
      'Maayo na. Kumusta ang nahibiling adlaw sa imong semana?',
      'Sige. Hinay-hinay lang, walay nagdali dinhi.',
    ],
  },
};

/** Rotates through the pool so the same line never lands twice running. */
function mockReply(level, language, turn) {
  const pool = MOCK_REPLIES[level]?.[language] ?? MOCK_REPLIES[level].en;
  return pool[turn % pool.length];
}

/**
 * @param {Array<{role:'user'|'assistant', content:string}>} history
 * @param {string} message  the new user message
 * @param {string} language en | tl | ceb
 */
export async function respond(history, message, language = 'en') {
  const floor = deterministicFloor(message);
  const started = Date.now();
  const turn = history.filter((m) => m.role === 'assistant').length;

  let result;
  let mocked = false;

  if (isMocked()) {
    await new Promise((r) => setTimeout(r, 350));
    const level = floor !== 'low' ? floor : 'moderate';
    result = {
      reply: mockReply(level, language, turn),
      risk_level: level,
      risk_score: { severe: 0.95, high: 0.75, moderate: 0.4, low: 0.1 }[level],
    };
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
          temperature: 0.7,
          max_tokens: 300,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT(language) },
            // Last 20 turns is enough context without unbounded cost.
            ...history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
          ],
        }),
      });

      if (!res.ok) throw new Error(`companion failed (${res.status})`);
      const data = await res.json();
      result = JSON.parse(data.choices[0].message.content);
    } catch (err) {
      // A failed model call must not swallow a disclosure. Fall back to a
      // safe acknowledgement and let the floor drive the escalation.
      console.error('AI companion failed:', err.message);
      const level = floor !== 'low' ? floor : 'moderate';
      result = {
        reply: mockReply(level, language, turn),
        risk_level: level,
        risk_score: floor === 'severe' ? 0.95 : floor === 'high' ? 0.75 : 0.4,
      };
    }
  }

  let level = RISK_LEVELS.includes(result.risk_level) ? result.risk_level : 'low';
  let score = Number.isFinite(Number(result.risk_score))
    ? Math.min(1, Math.max(0, Number(result.risk_score)))
    : 0.1;

  // The floor raises, never lowers.
  if (rank(floor) > rank(level)) {
    level = floor;
    score = Math.max(score, floor === 'severe' ? 0.9 : 0.7);
  }

  return {
    reply: String(result.reply || '').slice(0, 1200),
    risk_level: level,
    risk_score: score,
    response_ms: Date.now() - started,
    mocked,
  };
}
