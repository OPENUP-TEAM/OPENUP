import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Finds parameterised queries with a gap in their $N sequence.
 *
 *   npm run check:sql
 *
 * Postgres cannot infer the type of a placeholder that never appears in
 * the SQL, so `... WHERE a = $1 AND b = $3` with three parameters fails
 * at runtime with "could not determine data type of parameter $2". It
 * parses fine, passes a syntax check, and only breaks when someone opens
 * the page — which is how one reached the accomplishment report.
 *
 * Also flags the opposite: more parameters passed than the SQL uses,
 * which is usually a leftover argument after an edit.
 */

const ROOT = new URL('../src', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

let checked = 0;
let problems = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const re = /`([^`]*?\$\d[^`]*?)`\s*,\s*\[([^\]]*)\]/gs;

  for (const m of src.matchAll(re)) {
    const [, sql, argsRaw] = m;

    // SQL built with a JS interpolation has placeholders this cannot see
    // (a dynamic SET clause, for example), so counting them is meaningless.
    // Skipping is right: a checker that reports false problems gets muted,
    // and then it catches nothing.
    if (sql.includes('${')) continue;

    const nums = [...sql.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]));
    if (!nums.length) continue;
    checked++;

    const used = new Set(nums);
    const highest = Math.max(...nums);
    const missing = [];
    for (let i = 1; i <= highest; i++) if (!used.has(i)) missing.push(i);

    // Rough argument count: top-level commas only.
    let depth = 0;
    let args = argsRaw.trim() ? 1 : 0;
    for (const ch of argsRaw) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) args++;
    }

    const line = src.slice(0, m.index).split('\n').length;
    const where = `${relative(ROOT, file)}:${line}`;
    const snippet = sql.replace(/\s+/g, ' ').trim().slice(0, 64);

    if (missing.length) {
      console.log(`GAP     ${where}  never uses $${missing.join(', $')}`);
      console.log(`        ${snippet}...`);
      problems++;
    } else if (args > highest) {
      console.log(`EXTRA   ${where}  passes ${args} arguments, SQL uses ${highest}`);
      console.log(`        ${snippet}...`);
      problems++;
    }
  }
}

console.log(
  problems
    ? `\n${checked} queries checked, ${problems} problem(s).\n`
    : `\n${checked} queries checked, all placeholders contiguous.\n`
);
process.exit(problems ? 1 : 0);
