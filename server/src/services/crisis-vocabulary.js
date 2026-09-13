/**
 * Crisis vocabulary, in one place.
 *
 * These phrases are used twice:
 *
 *   1. As model adaptation hints sent to Google Chirp 2, so the recogniser
 *      is biased toward hearing them correctly.
 *   2. As the deterministic safety floor in emotion.service.js.
 *
 * They must stay in sync. If the recogniser is tuned for one wording and
 * the floor checks for another, a disclosure gets transcribed correctly
 * and then missed anyway. Keeping both readers importing the same arrays
 * makes that mismatch impossible.
 *
 * Intent and hopelessness only. No methods are listed here and none
 * should be added: the goal is to recognise that someone is in danger,
 * not to describe how.
 */

/** Statements of intent to end one's life or cause serious self-harm. */
export const SEVERE_PHRASES = [
  // English
  'kill myself', 'killing myself', 'end my life', 'ending my life',
  'want to die', 'wanna die', 'better off dead', 'not worth living',
  'no reason to live', 'suicide', 'suicidal', 'end it all',
  'take my own life', 'wont be here tomorrow', "won't be here tomorrow",
  'say goodbye forever',

  // Filipino
  'magpakamatay', 'nagpakamatay', 'magpapakamatay', 'papatayin ko sarili ko',
  'ayoko nang mabuhay', 'gusto ko nang mamatay', 'wala nang saysay mabuhay',
  'wala na akong dahilan mabuhay', 'tatapusin ko na buhay ko',
  'tapusin ko na ang lahat', 'magbigti', 'nagbigti', 'magbibigti',
  'wala na akong silbi sa mundo',

  // Bisaya / Cebuano
  // 'hikog' and its inflections are the ordinary Cebuano words for suicide.
  // Leaving them out made the detector blind to the most common way a
  // Cebuano speaker states intent, which a real test caught.
  'hikog', 'maghikog', 'naghikog', 'mag hikog', 'maghikod', 'naghikod',
  'manghikog', 'hikugan', 'ihikog',
  'magpakamatay ko', 'magpakamatay nako', 'magpakamatay na ko',
  'gusto ko na mamatay', 'gusto nako mamatay', 'ganahan ko mamatay',
  'dili na ko gusto mabuhi', 'ayaw na ko mabuhi', 'ayoko na mabuhi',
  'mamatay na lang ko', 'mamatay nalang ko', 'wala nay pulos mabuhi',
  'patyon nako akong kaugalingon', 'patyon nako akong kaugalingun',
  'mas maayo pa nga patay na ko', 'maayo pa patay na ko',
  'tapuson na nako akong kinabuhi', 'tapuson nako ang tanan',
  'human na ko ani', 'human na akong kinabuhi',
];

/** Hopelessness and inability to continue, without stated intent. */
export const HIGH_PHRASES = [
  // English
  'hurt myself', 'harm myself', 'self harm', 'cannot go on', "can't go on",
  'cant go on', 'give up on everything', 'hopeless', 'no hope left',
  'nobody would notice', 'nobody would care', 'no way out',
  'trapped forever', 'cannot take it anymore', "can't take it anymore",
  'tired of everything', 'nothing matters anymore',

  // Filipino
  'hindi ko na kaya', 'di ko na kaya', 'wala na akong pag-asa',
  'sawa na ako sa lahat', 'wala nang kwenta', 'pagod na ako sa lahat',
  'wala nang magbabago', 'ako na lang mag-isa', 'walang nagmamalasakit',

  // Bisaya / Cebuano
  'wala nay pulos', 'wala nay paglaum', 'wala nay kapuslanan',
  'giluya na ko', 'dili na ko kaya', 'dili nako kaya',
  'kapoy na kaayo ko sa tanan', 'kapoy na ko sa tanan',
  'wala nay makatabang nako', 'wala koy mahimo',
  'usa ra ko', 'ako ra usa', 'walay nagpakabana nako',
  'wala nay mausab', 'sige na lang ni',
];

/**
 * Everyday distress vocabulary. Not escalation triggers — these are here
 * only as recogniser hints, because Chirp trained on general Cebuano text
 * is less likely to have seen mental health register specifically.
 */
export const CONTEXT_PHRASES = [
  'depressed', 'depression', 'anxiety', 'anxious', 'panic attack',
  'counseling', 'psychologist', 'mental health',
  'kagul-anan', 'kaguol', 'gikapoy', 'nabalaka', 'gisubo',
  'kalisang', 'gikulbaan', 'nagmug-ot',
  'lungkot', 'balisa', 'pagod', 'stress', 'problema',
];

/**
 * Phrase set for Google's model adaptation.
 *
 * Boost is 0 to 20. High values on the severe list are deliberate: a
 * false positive costs a resident a hotline card they did not need, while
 * a false negative costs a missed disclosure. Context phrases get a light
 * boost because over-boosting common words degrades everything else.
 */
export const boostPhrases = () => [
  ...SEVERE_PHRASES.map((value) => ({ value, boost: 18 })),
  ...HIGH_PHRASES.map((value) => ({ value, boost: 14 })),
  ...CONTEXT_PHRASES.map((value) => ({ value, boost: 8 })),
];
