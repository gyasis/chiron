#!/usr/bin/env node
/*
 * Chiron Library CORPUS builder — the retrieval body behind the Ask page.
 *
 * library.index.json is a CATALOG: 338 lessons of metadata, zero prose. Acolyte's
 * `rag.sourceUrl` wants the opposite — a flat array of passages with real text:
 *     [{ id, title, text, meta }]
 * This script walks each ready lesson's lesson.html, cuts it into section-sized
 * passages, and writes <out>/library.corpus.json in exactly that shape.
 *
 * INGEST (how a new lesson joins the corpus):
 *   build-library-index.mjs calls this at the end of every rebuild, and the server
 *   rebuilds the index on accept / publish / bundle. So a lesson enters the corpus
 *   at the same moment it enters the library — no separate step to remember.
 *   Work is incremental: each lesson's html is fingerprinted (mtime:size) in
 *   .corpus-cache.json, and an unchanged lesson is reused verbatim rather than
 *   re-parsed. A rebuild after one new lesson parses one lesson.
 *
 *   build-library-corpus.mjs                 full pass (cached; cheap)
 *   build-library-corpus.mjs --only <slug>   re-extract one lesson, reuse the rest
 *   build-library-corpus.mjs --force         ignore the cache entirely
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dirname, '..');
const GEN = join(homedir(), 'Documents', 'generated');
const OUT = join(GEN, 'chiron-library');
const CORPUS = join(OUT, 'library.corpus.json');
const CACHE = join(OUT, '.corpus-cache.json');

const argv = process.argv.slice(2);
const ONLY = (i => (i >= 0 ? argv[i + 1] : null))(argv.indexOf('--only'));
const FORCE = argv.includes('--force');

/* Passage sizing. Single-vector embedders lose precision past ~600 tokens, so a
 * whole 50 KB chapter is a bad retrieval unit — chapters are cut at their headings
 * and hard-capped. Floor drops nav stubs and empty widget shells. */
const MAX_CHARS = 1400;
const MIN_CHARS = 120;

/* Interactive widgets, not prose. Their text is drill scaffolding and it poisons
 * retrieval (a spaced-repetition drawer matches every query about its own words). */
const SKIP_IDS = new Set(['sr-drawer', 'match-madness', 'match-madness-2', 'flashcards', 'quiz']);

/* ---------- html → text ---------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENT[g] ?? m;
  });
}

function toText(html) {
  return decode(
    html
      .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|figcaption|blockquote)>/gi, ' \n')
      .replace(/<br\s*\/?>/gi, ' \n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/* ---------- section scanner ---------- */

/** Outermost <section> blocks only — a chapter, not its nested widget sections. */
function outerSections(html) {
  const out = [];
  const open = /<section\b([^>]*)>/gi;
  let m;
  while ((m = open.exec(html))) {
    const attrs = m[1];
    const start = m.index;
    // walk forward balancing section tags
    let depth = 1, i = open.lastIndex;
    const tag = /<\/?section\b[^>]*>/gi;
    tag.lastIndex = i;
    let t, end = html.length;
    while ((t = tag.exec(html))) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = tag.lastIndex; i = tag.lastIndex; break; }
    }
    const id = (attrs.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    out.push({ id, html: html.slice(start, end) });
    open.lastIndex = i;            // skip past the whole block — no nested re-entry
  }
  return out;
}

const HEADING = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

/** Cut one chapter into heading-delimited chunks, then hard-cap each. */
function chunkSection(sectionHtml) {
  const marks = [];
  let m;
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(sectionHtml))) marks.push({ at: m.index, end: HEADING.lastIndex, title: toText(m[2]) });

  const parts = [];
  if (!marks.length) {
    parts.push({ title: '', html: sectionHtml });
  } else {
    if (marks[0].at > 0) parts.push({ title: '', html: sectionHtml.slice(0, marks[0].at) });
    marks.forEach((h, i) => {
      const stop = i + 1 < marks.length ? marks[i + 1].at : sectionHtml.length;
      parts.push({ title: h.title, html: sectionHtml.slice(h.end, stop) });
    });
  }

  const chunks = [];
  for (const p of parts) {
    const text = toText(p.html);
    if (text.length < MIN_CHARS) continue;
    for (const piece of split(text)) chunks.push({ title: p.title, text: piece });
  }
  return chunks;
}

/** Cap length, preferring a sentence/newline boundary. */
function split(text) {
  if (text.length <= MAX_CHARS) return [text];
  const out = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    let cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length >= MIN_CHARS) out.push(rest);
  else if (out.length) out[out.length - 1] += ' ' + rest;
  return out;
}

/* ---------- per-lesson extraction ---------- */

/* video-it episodes render their content from an embedded `const DATA = {...}`
 * payload, not from <section> prose — a section walk finds nothing in them. Cut
 * one passage per scene instead: the situation, what's on screen, and every line
 * with its gloss and teaching note. That last part is the whole point — "how do
 * they say X" is answerable only from the lines. */
function extractEpisode(lesson, html) {
  const i = html.indexOf('const DATA = ');
  if (i < 0) return null;
  const j = html.indexOf(', scenes =', i);
  let data;
  try { data = JSON.parse(html.slice(i + 13, j < 0 ? undefined : j)); } catch { return null; }
  const scenes = data.scenes || [];
  if (!scenes.length) return null;

  return scenes.map(s => {
    const lines = (s.lines || []).map(l => {
      const note = l.teaching_note ? ` (${toText(l.teaching_note)})` : '';
      return `${l.character || '—'}: ${l.italian_text || ''}${l.en_gloss ? ` — ${l.en_gloss}` : ''}${note}`;
    });
    const text = [
      s.situation || '',
      s.visual_situation?.it || '',
      (s.target_structures || []).length ? `Strutture: ${(s.target_structures || []).join('; ')}` : '',
      ...lines,
    ].filter(Boolean).join('\n');
    return {
      id: `${lesson.id}#scene-${s.scene}`,
      title: `${lesson.title} — Scena ${s.scene}: ${s.title || ''}`.trim(),
      text,
      meta: {
        lesson: lesson.title, lessonId: lesson.id, domain: lesson.domain || null,
        system: null, subject: lesson.subject || null, level: lesson.level || null,
        section: `scene-${s.scene}`, scene: s.scene, t: s.start ?? null,
        href: `/lessons/${relPath(lesson.path)}#t=${Math.round(s.start || 0)}`,
      },
    };
  }).filter(p => p.text.length >= MIN_CHARS);
}

function extract(lesson, file) {
  const html = readFileSync(file, 'utf8');
  const ep = extractEpisode(lesson, html);
  if (ep && ep.length) return ep;
  const passages = [];
  for (const sec of outerSections(html)) {
    if (!sec.id || SKIP_IDS.has(sec.id)) continue;
    const chunks = chunkSection(sec.html);
    chunks.forEach((c, n) => {
      passages.push({
        id: `${lesson.id}#${sec.id}${chunks.length > 1 ? `-${n + 1}` : ''}`,
        title: c.title ? `${lesson.title} — ${c.title}` : lesson.title,
        text: c.text,
        meta: {
          lesson: lesson.title,
          lessonId: lesson.id,
          domain: lesson.domain || null,
          system: lesson.system || null,
          subject: lesson.subject || null,
          level: lesson.level || null,
          section: sec.id,
          // the source-card jump target, served by :8911
          href: `/lessons/${relPath(lesson.path)}#${sec.id}`,
        },
      });
    });
  }
  return passages;
}

/* ---------- main ---------- */

const indexFile = join(OUT, 'library.index.json');
if (!existsSync(indexFile)) {
  process.stderr.write('library.index.json missing — run build-library-index.mjs first\n');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// `path` in library.index.json comes in TWO shapes and both are legitimate:
//   bare      `<rel>/lesson.html`            — what the indexer writes for an unbundled lesson
//   served    `lessons/<slug>/lesson.html`   — what a BUNDLED lesson needs, because library.js
//                                              streams l.path directly without prefixing
// This file needs the bare form for the filesystem and the served form for hrefs, so normalise
// once here instead of assuming one shape. Assuming the bare shape is what made a full re-index
// report `missing html 330`.
const relPath = (p) => (p || '').startsWith('lessons/') ? p.slice('lessons/'.length) : (p || '');
const lessonFile = (p) => {
  const bare = join(GEN, p);
  if (existsSync(bare)) return bare;
  const under = join(OUT, p);
  if (existsSync(under)) return under;
  return join(OUT, 'lessons', relPath(p));
};

const index = JSON.parse(readFileSync(indexFile, 'utf8'));
let cache = {};
if (!FORCE && existsSync(CACHE)) {
  try { cache = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
}

const lessons = (index.lessons || []).filter(l => l.ready && l.path);
const next = {};
const corpus = [];
let parsed = 0, reused = 0, missing = 0;

for (const l of lessons) {
  const file = lessonFile(l.path);
  let st;
  try { st = statSync(file); } catch { missing++; continue; }
  const fp = `${Math.round(st.mtimeMs)}:${st.size}`;
  const hit = cache[l.id];
  // --only re-extracts that one lesson even if its fingerprint is unchanged
  // (the accept-time path: html rewritten in the same second keeps its mtime).
  const forceThis = FORCE || (ONLY !== null && l.id === ONLY);

  if (hit && hit.fp === fp && !forceThis) {
    next[l.id] = hit; corpus.push(...hit.passages); reused++;
    continue;
  }
  try {
    const passages = extract(l, file);
    next[l.id] = { fp, passages };
    corpus.push(...passages);
    parsed++;
  } catch (e) {
    process.stderr.write(`corpus: ${l.id} failed — ${e.message}\n`);
    if (hit) { next[l.id] = hit; corpus.push(...hit.passages); }
  }
}

writeFileSync(CORPUS, JSON.stringify(corpus));
writeFileSync(CACHE, JSON.stringify(next));

/* Per-domain shards. The corpus is wildly lopsided — medicine is ~95% of it — so a
 * scoped ask should never pay for the whole body. The scope selector picks a shard;
 * only "everything" loads the full file. */
const shards = {};
for (const p of corpus) (shards[p.meta.domain || 'other'] ||= []).push(p);
const shardLines = [];
for (const [dom, ps] of Object.entries(shards)) {
  const f = join(OUT, `library.corpus.${dom}.json`);
  writeFileSync(f, JSON.stringify(ps));
  shardLines.push(`    ${dom.padEnd(16)} ${String(ps.length).padStart(6)} passages  ${(statSync(f).size / 1048576).toFixed(1)} MB`);
}

// Passage counts, so the UI can state what it is actually searching rather than
// counting lessons (a lesson is not a retrieval unit — a passage is).
writeFileSync(join(OUT, 'library.corpus.stats.json'), JSON.stringify({
  total: corpus.length,
  byDomain: Object.fromEntries(Object.entries(shards).map(([d, ps]) => [d, ps.length])),
  lessons: lessons.length,
}));

const mb = (statSync(CORPUS).size / 1048576).toFixed(1);
console.log(`Corpus built → ${CORPUS}`);
console.log(`  lessons: ${lessons.length} (parsed ${parsed}, cached ${reused}, missing html ${missing})`);
console.log(`  passages: ${corpus.length}   size: ${mb} MB`);
console.log(`  shards:\n${shardLines.sort().join('\n')}`);
