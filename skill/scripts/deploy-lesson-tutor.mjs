#!/usr/bin/env node
/*
 * Put the acolyte-driven tutor sidebar on a lesson.
 *
 *   deploy-lesson-tutor.mjs --lesson <slug>       one lesson
 *   deploy-lesson-tutor.mjs --domain language-it  every lesson in a domain
 *   deploy-lesson-tutor.mjs --all                 the whole library
 *   deploy-lesson-tutor.mjs --check               report coverage, change nothing
 *   deploy-lesson-tutor.mjs --remove --lesson X   take it back off
 *
 * SELF-CONTAINED, per R-CH-PIPELINE. The bundle is COPIED into the lesson as a
 * sibling and referenced relatively — never `../../shell/`. A lesson is a .chiron
 * zip; an up-tree path 404s the moment it is served from anywhere else, and the
 * failure looks like "the tutor is broken" rather than "the path was wrong".
 *
 * Cost: ~470 KB per lesson. Against a 9.4 GB library that is ~1.6%, and it buys
 * a lesson that still works unzipped on a phone with no server behind it.
 *
 * IDEMPOTENT. Injection is marked, so re-running updates the assets and never
 * doubles the script tags.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHELL = join(__dirname, '..', 'shell');
const VENDOR = join(__dirname, '..', 'ask', 'vendor');
// TWO roots hold every lesson, and only ONE of them is what the browser gets.
// The server mounts /lessons at ~/Documents/generated (the top-level dir); the
// copy under chiron-library/lessons is what gets zipped into a .chiron bundle.
// Deploying to the library copy alone writes files nobody ever loads — the page
// 404s the asset while the file plainly exists on disk, which reads as a server
// bug. Both roots get it, so the served page and the bundle agree.
const GEN = join(homedir(), 'Documents', 'generated');
const ROOTS = [GEN, join(GEN, 'chiron-library', 'lessons')];

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const ONE = flag('--lesson', null);
const DOMAIN = flag('--domain', null);
const ALL = argv.includes('--all');
const CHECK = argv.includes('--check');
const REMOVE = argv.includes('--remove');
const FORCE = argv.includes('--force');

// 17 lessons already carry the LEGACY tutor (tutor.js, or inlined by the FSI /
// episode assemblers). Mounting acolyte there too gives the page two tutors
// racing for the same :8912 service and two chat panels — so those are skipped
// unless --force says otherwise. Retiring the legacy widget on those lessons is
// a separate decision, not something a deploy script should make silently.
const LEGACY = /tutor-models|tutor-chat|ct-panel|src=["']tutor\.js/;

const MARK_OPEN = '<!-- chiron:tutor -->';
const MARK_CLOSE = '<!-- /chiron:tutor -->';
const BLOCK = `${MARK_OPEN}
<link rel="stylesheet" href="tutor-acolyte.css">
<script type="module" src="tutor-acolyte.js"></script>
${MARK_CLOSE}`;

const ASSETS = [
  [join(VENDOR, 'acolyte.js'), 'acolyte.js'],
  [join(SHELL, 'tutor-acolyte.js'), 'tutor-acolyte.js'],
  [join(SHELL, 'tutor-acolyte.css'), 'tutor-acolyte.css'],
];
// The code-split chunk is not optional. Vendoring only index.js makes the page
// hang at boot with NO error — the import resolves, the chunk 404s, and nothing
// says so. This cost a debugging session once already.
for (const f of readdirSync(VENDOR)) if (/^chunk-.*\.js$/.test(f)) ASSETS.push([join(VENDOR, f), f]);

function lessonDirs() {
  let dirs = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const d = join(root, name);
      if (name === 'chiron-library') continue;         // handled as its own root
      try {
        if (statSync(d).isDirectory() && existsSync(join(d, 'lesson.html'))) dirs.push(d);
      } catch { /* unreadable entry */ }
    }
  }
  if (ONE) dirs = dirs.filter(d => d.endsWith('/' + ONE));
  if (DOMAIN) dirs = dirs.filter(d => {
    try { return JSON.parse(readFileSync(join(d, 'chiron.json'), 'utf8')).domain === DOMAIN; }
    catch { return false; }
  });
  return dirs;
}

const dirs = lessonDirs();
if (!dirs.length) {
  console.error('no lessons matched' + (ONE ? ` --lesson ${ONE}` : DOMAIN ? ` --domain ${DOMAIN}` : ''));
  process.exit(1);
}
if (!ONE && !DOMAIN && !ALL && !CHECK) {
  console.error(`${dirs.length} lessons matched — pass --all to mean it, or --lesson/--domain to narrow.`);
  process.exit(2);
}

let on = 0, off = 0, changed = 0, legacy = 0;
for (const d of dirs) {
  const page = join(d, 'lesson.html');
  const html = readFileSync(page, 'utf8');
  const has = html.includes(MARK_OPEN);
  has ? on++ : off++;
  if (CHECK) { if (LEGACY.test(html)) legacy++; continue; }
  if (!REMOVE && !FORCE && !has && LEGACY.test(html)) { legacy++; continue; }

  if (REMOVE) {
    if (!has) continue;
    const i = html.indexOf(MARK_OPEN), j = html.indexOf(MARK_CLOSE) + MARK_CLOSE.length;
    writeFileSync(page, html.slice(0, i).replace(/\n$/, '') + html.slice(j));
    changed++;
    continue;
  }

  const at = html.lastIndexOf('</body>');
  if (at < 0 && !has) { console.warn(`  skip (no </body>): ${d}`); continue; }

  // Copy only once the lesson is known to be injectable — otherwise a skipped
  // lesson still carries 470 KB of assets nothing on the page ever loads.
  for (const [src, name] of ASSETS) copyFileSync(src, join(d, name));

  if (has) {
    // Assets refreshed above; the tags are already correct. Re-injecting would
    // mount the widget twice.
    changed++;
    continue;
  }
  writeFileSync(page, html.slice(0, at) + BLOCK + '\n' + html.slice(at));
  changed++;
}

if (CHECK) {
  console.log(`tutor sidebar: ${on} of ${dirs.length} lessons have it (${off} without)`);
  console.log(`  ${legacy} carry the legacy tutor and are skipped by default (--force to override)`);
  process.exit(0);
}
console.log(`${REMOVE ? 'removed from' : 'deployed to'} ${changed} lesson${changed === 1 ? '' : 's'}`);
if (legacy) console.log(`  skipped ${legacy} that already have the legacy tutor (--force to override)`);
if (!REMOVE) console.log(`  assets: ${ASSETS.map(a => a[1]).join(', ')}`);
