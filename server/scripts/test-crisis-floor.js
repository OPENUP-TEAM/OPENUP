/**
 * Crisis floor test.
 *
 *   npm run test:crisis
 *
 * The deterministic floor is the last line of defence when the language
 * model fails, so it gets its own test. Add a case here whenever real
 * testing turns up a phrasing it missed.
 */
import { SEVERE_PHRASES, HIGH_PHRASES } from '../src/services/crisis-vocabulary.js';

function floor(text) {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ')} `;
  const hit = (list) => list.find((m) => t.includes(` ${m} `) || t.includes(m));
  const s = hit(SEVERE_PHRASES); if (s) return ['severe', s];
  const h = hit(HIGH_PHRASES);   if (h) return ['high', h];
  return ['low', null];
}

const cases = [
  // From the actual test session
  ['I have to suicide now!',            'severe'],
  ['magpakamatay nako!',                'severe'],
  ['kuyog ta maghikod',                 'severe'],
  ['uban ka magpakamatay?',             'severe'],
  // Other realistic phrasings
  ['naghikog na lang unta ko',          'severe'],
  ['gusto nako mamatay',                'severe'],
  ['dili na ko gusto mabuhi',           'severe'],
  ['tapuson na nako akong kinabuhi',    'severe'],
  ['magbigti na lang ako',              'severe'],
  ['wala nay paglaum',                  'high'],
  ['dili nako kaya',                    'high'],
  ['hindi ko na kaya',                  'high'],
  ['kapoy na ko sa tanan',              'high'],
  // Must NOT fire
  ['kapoy kaayo ko karon sa trabaho',   'low'],
  ['naglagot ko sa akong boss',         'low'],
  ['I had a good day today',            'low'],
  ['gikapoy ko pero okay ra',           'low'],
];

let pass = 0, fail = 0;
for (const [text, expected] of cases) {
  const [got, matched] = floor(text);
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${expected.padEnd(6)} got ${got.padEnd(6)} "${text}"${matched ? `  [${matched}]` : ''}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
