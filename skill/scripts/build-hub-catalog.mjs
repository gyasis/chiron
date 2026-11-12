#!/usr/bin/env node
/* Chiron hub catalog: bundle every READY lesson → <out>/lessons/<slug>.chiron,
 * and emit <out>/lessons/lessons.json (manifest the phone app syncs from).
 * Reads library.index.json (built by build-library-index.mjs). Run that first. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(homedir(), 'Documents', 'generated');
const OUT = join(GEN, 'chiron-library');
const LESSONS_DIR = join(OUT, 'lessons');
const BUNDLER = join(SKILL, 'scripts', 'bundle-lesson.sh');
mkdirSync(LESSONS_DIR, { recursive: true });

const index = JSON.parse(readFileSync(join(OUT, 'library.index.json'), 'utf8'));
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;   // bundle ONE slug (the server calls this on accept)
const ready = index.lessons.filter((l) => l.ready && (!only || l.id.replace(/[\/]/g, '-') === only));
// The bundler gets the lesson's OWN domain (chiron.json, else content.json). A lesson with none is skipped and
// listed: the index's display fallback is a guess and never seeds a manifest.
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const ownDomain = (dir) => readJson(join(dir, 'chiron.json')).domain || readJson(join(dir, 'content.json')).domain || '';
const catalog = [];
let ok = 0, fail = 0;
const skippedNoDomain = [];
for (const l of ready) {
  const slug = l.id.replace(/[\/]/g, '-');
  const lessonDir = join(GEN, l.id);
  const out = join(LESSONS_DIR, slug + '.chiron');
  const domain = ownDomain(lessonDir);
  if (!domain) { skippedNoDomain.push(l.id); continue; }
  try {
    execFileSync('bash', [BUNDLER, lessonDir, out, '--domain', domain], { stdio: 'pipe' });
    // Extract the self-contained bundle UNDER the served root so "Open → stream from hub" works over
    // LAN HTTPS (the un-zipped lesson.html + sibling themes/audio; no ../-escape of the document root).
    const extractDir = join(LESSONS_DIR, slug);
    execFileSync('unzip', ['-oq', out, '-d', extractDir], { stdio: 'pipe' });
    let entry = 'lesson.html';
    try { entry = JSON.parse(readFileSync(join(extractDir, 'chiron.json'), 'utf8')).entry || entry; } catch {}
    l.path = `lessons/${slug}/${entry}`;   // root-relative; library.js Open() streams this directly
    const sizeMB = +(statSync(out).size / 1048576).toFixed(1);
    catalog.push({ file: slug + '.chiron', entry, title: l.title, domain: l.domain, system: l.system, subject: l.subject,
      topic: l.topic, level: l.level, scope: l.scope, trend: l.trend, clips: l.clips, sizeMB });
    ok++;
  } catch (e) { fail++; process.stderr.write(`bundle fail ${slug}: ${String(e.message).slice(0,80)}\n`); }
}
// --only bundles one lesson → UPSERT it into the existing manifest instead of replacing the whole thing
let manifest = catalog;
if (only && existsSync(join(LESSONS_DIR, 'lessons.json'))) {
  try {
    const prev = JSON.parse(readFileSync(join(LESSONS_DIR, 'lessons.json'), 'utf8')).lessons || [];
    const byFile = new Map(prev.map((e) => [e.file, e]));
    for (const e of catalog) byFile.set(e.file, e);
    manifest = [...byFile.values()];
  } catch {}
}
writeFileSync(join(LESSONS_DIR, 'lessons.json'), JSON.stringify({ generatedAt: new Date().toISOString(), lessons: manifest }, null, 2));
// persist the root-relative `path` rewrites (Open streams these) back into the index the app reads
writeFileSync(join(OUT, 'library.index.json'), JSON.stringify(index, null, 2));
console.log(`hub catalog → ${LESSONS_DIR}`);
if (skippedNoDomain.length) {
  console.log(`  skipped: no domain (${skippedNoDomain.length}) — fix with: python3 scripts/lesson_manifest.py stamp <dir> --domain <domain>`);
  for (const id of skippedNoDomain) console.log(`    ${id}`);
}
console.log(`  bundled: ${ok}   failed: ${fail}   manifest: lessons.json (${catalog.length} entries)`);
