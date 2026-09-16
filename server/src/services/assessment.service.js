/**
 * Mental health screening instruments.
 *
 * PHQ-9 and GAD-7 are used rather than invented questions. A made-up
 * questionnaire produces a number that means nothing: there is no
 * validation behind the cut-offs, so "you scored 14" cannot be
 * interpreted. Both instruments are free to reproduce without permission
 * and are the standard screeners in Philippine primary care.
 *
 * Cite in the manuscript:
 *   PHQ-9 — Kroenke K, Spitzer RL, Williams JBW (2001). The PHQ-9:
 *   validity of a brief depression severity measure. J Gen Intern Med.
 *   GAD-7 — Spitzer RL, Kroenke K, Williams JBW, Löwe B (2006). A brief
 *   measure for assessing generalized anxiety disorder. Arch Intern Med.
 *
 * On translation: item wording is part of what was validated. A machine
 * translation into Bisaya or Filipino produces something that looks like
 * the instrument but has no validated cut-offs behind it. If the system
 * is to offer these in another language, the translation must come from
 * the instrument's official translation library, and the manuscript
 * should say which version was used. English only for now, stated
 * honestly rather than faked.
 */

const FREQUENCY_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];

export const INSTRUMENTS = {
  phq9: {
    key: 'phq9',
    name: 'Depression check-in',
    formal_name: 'PHQ-9',
    description: 'Nine questions about how you have been feeling over the last two weeks.',
    lead_in: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
    options: FREQUENCY_OPTIONS,
    max_score: 27,
    // Index 8 (the ninth item) asks about thoughts of self-harm. Any
    // answer above zero is followed up regardless of the total.
    safety_item_index: 8,
    items: [
      'Little interest or pleasure in doing things',
      'Feeling down, depressed, or hopeless',
      'Trouble falling or staying asleep, or sleeping too much',
      'Feeling tired or having little energy',
      'Poor appetite or overeating',
      'Feeling bad about yourself, or that you are a failure, or have let yourself or your family down',
      'Trouble concentrating on things, such as reading the newspaper or watching television',
      'Moving or speaking so slowly that other people could have noticed, or being so fidgety or restless that you have been moving around a lot more than usual',
      'Thoughts that you would be better off dead or of hurting yourself in some way',
    ],
    bands: [
      { min: 0,  max: 4,  severity: 'minimal',          label: 'Minimal or none' },
      { min: 5,  max: 9,  severity: 'mild',             label: 'Mild' },
      { min: 10, max: 14, severity: 'moderate',         label: 'Moderate' },
      { min: 15, max: 19, severity: 'moderately severe', label: 'Moderately severe' },
      { min: 20, max: 27, severity: 'severe',           label: 'Severe' },
    ],
  },

  gad7: {
    key: 'gad7',
    name: 'Anxiety check-in',
    formal_name: 'GAD-7',
    description: 'Seven questions about worry and tension over the last two weeks.',
    lead_in: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
    options: FREQUENCY_OPTIONS,
    max_score: 21,
    safety_item_index: null,
    items: [
      'Feeling nervous, anxious, or on edge',
      'Not being able to stop or control worrying',
      'Worrying too much about different things',
      'Trouble relaxing',
      'Being so restless that it is hard to sit still',
      'Becoming easily annoyed or irritable',
      'Feeling afraid as if something awful might happen',
    ],
    bands: [
      { min: 0,  max: 4,  severity: 'minimal',  label: 'Minimal or none' },
      { min: 5,  max: 9,  severity: 'mild',     label: 'Mild' },
      { min: 10, max: 14, severity: 'moderate', label: 'Moderate' },
      { min: 15, max: 21, severity: 'severe',   label: 'Severe' },
    ],
  },
};

/** What a resident is told, per band. Never a diagnosis. */
const GUIDANCE = {
  minimal: 'Your answers do not suggest much is weighing on you at the moment. Checking in now and then is still worth doing.',
  mild: 'Your answers suggest some things have been harder than usual. Keeping a mood log or talking it through can help you see whether it shifts.',
  moderate: 'Your answers suggest you have been carrying a fair amount lately. Booking a session with a psychologist would be a reasonable next step.',
  'moderately severe': 'Your answers suggest things have been heavy for a while. Talking to a licensed psychologist is worth doing soon rather than waiting to see if it lifts.',
  severe: 'Your answers suggest you have been struggling a great deal. Please consider booking a session, and reach out to someone today if you need to.',
};

export function scoreAssessment(instrumentKey, answers) {
  const instrument = INSTRUMENTS[instrumentKey];
  if (!instrument) throw new Error('Unknown instrument.');

  if (!Array.isArray(answers) || answers.length !== instrument.items.length)
    throw new Error(`Answer all ${instrument.items.length} questions.`);

  if (answers.some((a) => !Number.isInteger(a) || a < 0 || a > 3))
    throw new Error('Each answer must be between 0 and 3.');

  const score = answers.reduce((a, b) => a + b, 0);
  const band = instrument.bands.find((b) => score >= b.min && score <= b.max);

  // A low total with the safety item endorsed still needs follow-up. This
  // is standard practice with the PHQ-9: someone can answer "not at all"
  // to eight items and still be in danger.
  const safetyIndex = instrument.safety_item_index;
  const flagged = safetyIndex !== null && answers[safetyIndex] > 0;

  return {
    instrument: instrumentKey,
    score,
    max_score: instrument.max_score,
    severity: band.severity,
    result: band.label,
    guidance: GUIDANCE[band.severity],
    flagged_item: flagged,
    // Escalation is driven by either signal, not the total alone.
    needs_followup: flagged || ['moderately severe', 'severe'].includes(band.severity),
  };
}

export const listInstruments = () =>
  Object.values(INSTRUMENTS).map(({ bands, safety_item_index, ...rest }) => rest);
