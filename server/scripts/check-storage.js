import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/**
 * Storage check.
 *
 *   npm run check:storage
 *
 * Supabase JS reports connection problems as "fetch failed", which hides
 * whether the real cause was a missing bucket, a bad key, or no network.
 * This separates them.
 */

const REQUIRED = [
  { name: 'licenses',  purpose: 'PRC license documents' },
  { name: 'journals',  purpose: 'voice journal audio' },
  { name: 'resources', purpose: 'wellness resource attachments' },
];

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m, fix) => {
  console.log(`  FAIL  ${m}`);
  if (fix) console.log(`        -> ${fix}`);
  failures++;
};

let failures = 0;

console.log('\nOpenUp storage check\n');

console.log('Configuration');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  bad('SUPABASE_URL is not set', 'Add it to .env: https://your-ref.supabase.co');
} else if (url.includes('[ref]')) {
  bad('SUPABASE_URL still has the placeholder', 'Replace [ref] with your project ref.');
} else if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url.trim())) {
  bad(`SUPABASE_URL looks wrong: ${url}`,
      'It should be exactly https://your-ref.supabase.co with no path or trailing slash.');
} else {
  ok(`SUPABASE_URL ${url}`);
}

if (!key) {
  bad('SUPABASE_SERVICE_ROLE_KEY is not set',
      'Project Settings -> API -> service_role. Server only, never the client.');
} else if (key.length < 100) {
  bad('SUPABASE_SERVICE_ROLE_KEY looks too short',
      'You may have copied the anon key. The service_role key is the long one marked secret.');
} else {
  ok('SUPABASE_SERVICE_ROLE_KEY is set');
}

if (failures) {
  console.log(`\n${failures} problem(s) to fix before buckets can be checked.\n`);
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

console.log('\nBuckets');
try {
  const { data: buckets, error } = await supabase.storage.listBuckets();

  if (error) {
    bad(`could not list buckets — ${error.message}`,
        'Usually a wrong service_role key, or a paused Supabase project.');
  } else {
    const found = new Set(buckets.map((b) => b.name));
    for (const b of REQUIRED) {
      if (!found.has(b.name)) {
        bad(`missing bucket "${b.name}" (${b.purpose})`,
            `Supabase -> Storage -> New bucket -> name it exactly "${b.name}", Public OFF.`);
      } else {
        const bucket = buckets.find((x) => x.name === b.name);
        if (bucket.public) {
          bad(`bucket "${b.name}" is PUBLIC`,
              'These hold personal data. Make it private: Storage -> bucket -> Settings.');
        } else {
          ok(`"${b.name}" exists and is private`);
        }
      }
    }
  }
} catch (err) {
  // This is the case that produces "fetch failed" during an upload.
  bad(`could not reach Supabase Storage — ${err.message}`, null);
  if (err.cause) console.log(`        cause: ${err.cause.code ?? ''} ${err.cause.message ?? err.cause}`);
  console.log('        Check your internet connection and that the project is not paused.');
}

console.log(
  failures
    ? `\n${failures} problem(s) found.\n`
    : '\nStorage is configured correctly.\n'
);
process.exit(failures ? 1 : 0);
