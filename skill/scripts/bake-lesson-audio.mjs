#!/usr/bin/env node
/**
 * bake-lesson-audio.mjs — chiron lesson audio orchestrator
 *
 * Parses a generated lesson.html, extracts ALL audio-bake-able artifacts
 * from on-page anchors, enforces the dialogue voicing rule (persona-a only;
 * persona-b / data-learner turns are NEVER voiced), and calls bakeAudio.
 *
 * Usage:
 *   node skill/scripts/bake-lesson-audio.mjs <lesson-dir> [options]
 *
 * Options:
 *   --persona <id>     Override active persona (default: activePersonaFor('language-it'))
 *   --domain <domain>  Lesson domain for voice routing: language-it | medicine | code |
 *                      concepts | research-paper (default: 'language-it')
 *   --no-stories       Skip story-verbatim and story-description artifacts
 *   --no-dialogues     Skip dialogue artifacts
 *   --no-qc            Disable Gemini audio QC (default: on when GEMINI_API_KEY/GOOGLE_API_KEY set)
 *   --dry-run          Parse + print the artifact plan; do NOT call bakeAudio
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolved import paths (from skill/scripts/ → ../dist/lib/)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_LIB = path.resolve(__dirname, '..', 'dist', 'lib');

const { initDb } = await import(path.join(DIST_LIB, 'sqlite-init.js'));
const { bakeAudio } = await import(path.join(DIST_LIB, 'audio-bake.js'));
const { resolveLecture } = await import(path.join(DIST_LIB, 'schemas', 'lecture-script.js'));
const { loadPersona, activePersonaFor } = await import(path.join(DIST_LIB, 'persona.js'));

// ---------------------------------------------------------------------------
// CLI arg parse
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help') {
  process.stderr.write(
    'Usage: node skill/scripts/bake-lesson-audio.mjs <lesson-dir> [--persona <id>] [--no-stories] [--no-dialogues] [--dry-run]\n'
  );
  process.exit(1);
}

const lessonDir = path.resolve(argv[0]);
let personaIdArg = null;
let domainArg = null;
let skipStories = false;
let skipDialogues = false;
let dryRun = false;
let noQc = false;

for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--persona' && argv[i + 1]) { personaIdArg = argv[++i]; continue; }
  if (argv[i] === '--domain' && argv[i + 1]) { domainArg = argv[++i]; continue; }
  if (argv[i] === '--no-stories') { skipStories = true; continue; }
  if (argv[i] === '--no-dialogues') { skipDialogues = true; continue; }
  if (argv[i] === '--no-qc') { noQc = true; continue; }
  if (argv[i] === '--dry-run') { dryRun = true; continue; }
}

if (!fs.existsSync(lessonDir)) {
  process.stderr.write(`bake-lesson-audio: lesson dir not found: ${lessonDir}\n`);
  process.exit(1);
}

const courseId = path.basename(lessonDir);
const lessonHtml = path.join(lessonDir, 'lesson.html');
if (!fs.existsSync(lessonHtml)) {
  process.stderr.write(`bake-lesson-audio: lesson.html not found in ${lessonDir}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1 — Resolve persona + voice refs
// ---------------------------------------------------------------------------
const VOICES_REGISTRY = path.join(os.homedir(), '.chiron', 'voices.json');
if (!fs.existsSync(VOICES_REGISTRY)) {
  process.stderr.write(`bake-lesson-audio: voices registry not found: ${VOICES_REGISTRY}\n`);
  process.exit(1);
}
const voiceRegistry = JSON.parse(fs.readFileSync(VOICES_REGISTRY, 'utf8'));

/** domain drives both activePersonaFor lookup and resolveLecture voice routing */
const domain = domainArg ?? 'language-it';
const personaId = personaIdArg ?? activePersonaFor(domain) ?? 'lucrezia';
const persona = loadPersona(personaId);
if (!persona) {
  process.stderr.write(`bake-lesson-audio: could not load persona '${personaId}'\n`);
  process.exit(1);
}

// Build the voices map bakeAudio needs: { [voice-id]: { refAudio, refText } }
const voices = {};
for (const voiceId of Object.values(persona.voices)) {
  if (!voiceId) continue;
  if (!voiceRegistry[voiceId]) {
    process.stderr.write(`bake-lesson-audio: WARNING — no registry entry for voice '${voiceId}' (persona '${personaId}')\n`);
    continue;
  }
  voices[voiceId] = voiceRegistry[voiceId];
}

process.stderr.write(`[bake-lesson-audio] persona=${personaId}  domain=${domain}  voices=${Object.keys(voices).join(', ')}\n`);

// ---------------------------------------------------------------------------
// Step 2 — Parse lesson.html
// ---------------------------------------------------------------------------
const html = fs.readFileSync(lessonHtml, 'utf8');

// Helper: strip ALL HTML tags from a string; also collapse whitespace.
function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Helper: extract attribute value from an opening tag string.
function attr(tagStr, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tagStr);
  return m ? m[1] : null;
}

// Regex to match an opening tag with a given ID prefix and capture: id, full-tag, inner content.
// We need to handle multi-line inner content, so we search for the opening tag then grab
// everything up to the matching closing tag.

/**
 * Extract all elements whose id matches the given prefix pattern.
 * Returns array of { id, tag, inner, dataEn? }
 * Works for both <td id="vocab-…">…</td> and <p id="…">…</p> and <div id="…">…</div>
 */
function findElementsById(htmlStr, idPattern) {
  const results = [];
  // Match any opening tag that has an id= attribute matching the pattern.
  // We'll detect the tag name and then find its paired closing tag.
  const openTagRe = /<(\w+)\s[^>]*\bid="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = openTagRe.exec(htmlStr)) !== null) {
    const tagName = m[1].toLowerCase();
    const idVal = m[2];
    if (!idPattern.test(idVal)) continue;
    const tagStr = m[0];
    const start = m.index + m[0].length;
    // Find matching close tag (simple depth-count; handles nesting of same tag)
    const closeTag = `</${tagName}>`;
    const openTag = `<${tagName}`;
    let depth = 1;
    let pos = start;
    while (depth > 0 && pos < htmlStr.length) {
      const nextOpen = htmlStr.indexOf(openTag, pos);
      const nextClose = htmlStr.indexOf(closeTag, pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        if (depth === 0) {
          const inner = htmlStr.slice(start, nextClose);
          const dataEn = attr(tagStr, 'data-en') ?? undefined;
          results.push({ id: idVal, tagName, inner, dataEn });
        }
        pos = nextClose + closeTag.length;
      }
    }
  }
  return results;
}

// Sentence-split for story segments
function splitSentences(text) {
  return text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
}

// Strip «» guillemets from dialogue text
function stripGuillemets(s) {
  return s.replace(/[«»]/g, '').trim();
}

// ---------------------------------------------------------------------------
// 2a — Inline phrases: vocab-, instr-, q-, dx- elements with an id
// ---------------------------------------------------------------------------
const phraseArtifacts = [];
const phraseElements = findElementsById(html, /^(vocab|instr|q|dx)-/);
for (const el of phraseElements) {
  const text = stripTags(el.inner);
  if (!text) continue;
  phraseArtifacts.push({
    kind: 'phrase',
    sectionId: el.id,
    segments: [{ lang: 'it', text, gapAfter: 'sentence' }],
  });
}

// ---------------------------------------------------------------------------
// 2b — Grammar pearls: pearl- elements
// ---------------------------------------------------------------------------
const pearlArtifacts = [];
const pearlElements = findElementsById(html, /^pearl-/);
for (const el of pearlElements) {
  // Strip tags from inner content (reads the Italian rule text; data-en is the English gloss — ignored for audio)
  const text = stripTags(el.inner);
  if (!text) continue;
  pearlArtifacts.push({
    kind: 'grammar-pearl',
    sectionId: el.id,
    segments: [{ lang: 'it', text, gapAfter: 'sentence' }],
  });
}

// ---------------------------------------------------------------------------
// 2c — Stories and story-descriptions
// ---------------------------------------------------------------------------
const storyArtifacts = [];
if (!skipStories) {
  // story-verbatim: id="story-*" → Italian text split into sentences
  const storyElements = findElementsById(html, /^story-/);
  for (const el of storyElements) {
    const text = stripTags(el.inner);
    if (!text) continue;
    const sentences = splitSentences(text);
    storyArtifacts.push({
      kind: 'story-verbatim',
      sectionId: el.id,
      segments: sentences.map(s => ({ lang: 'it', text: s, gapAfter: 'sentence' })),
    });
  }

  // story-description: id="storydesc-*" → English text
  const storyDescElements = findElementsById(html, /^storydesc-/);
  for (const el of storyDescElements) {
    const text = stripTags(el.inner);
    if (!text) continue;
    storyArtifacts.push({
      kind: 'story-description',
      sectionId: el.id,
      segments: [{ lang: 'en', text }],
    });
  }
}

// ---------------------------------------------------------------------------
// 2d — Dialogues: enforce the dialogue voicing rule
//
// RULE: include ONLY turns whose class contains "persona-a".
//       SKIP any turn with class "persona-b" OR attribute data-learner="true".
//       Segments are pre-resolved (voice + gapAfterMs + pitchSemitones) so
//       they bypass resolveLecture.
// ---------------------------------------------------------------------------
const dialogueArtifacts = [];
let totalVoiced = 0;
let totalSkipped = 0;

if (!skipDialogues) {
  // Find all top-level dialogue containers: <div id="dlg-...">
  const dlgElements = findElementsById(html, /^dlg-/);

  for (const dlg of dlgElements) {
    const dlgId = dlg.id;
    const inner = dlg.inner;
    let voiced = 0;
    let skipped = 0;
    const segments = [];

    // Find each turn div within the dialogue inner HTML
    const turnRe = /<div\s([^>]*)>/gi;
    let tm;
    while ((tm = turnRe.exec(inner)) !== null) {
      const turnAttrs = tm[1];
      const turnClassM = /\bclass="([^"]*)"/.exec(turnAttrs);
      const turnClass = turnClassM ? turnClassM[1] : '';
      const hasDataLearner = /\bdata-learner="true"/.test(turnAttrs);

      const isPersonaA = /\bpersona-a\b/.test(turnClass);
      const isPersonaB = /\bpersona-b\b/.test(turnClass);

      if (!isPersonaA && !isPersonaB && !hasDataLearner) continue; // not a turn div

      if (!isPersonaA || isPersonaB || hasDataLearner) {
        // Learner turn — count and skip
        skipped++;
        continue;
      }

      // persona-a turn: extract the <span class="it">...</span>
      const turnStart = tm.index + tm[0].length;
      // Find the closing </div> for this turn (depth-aware)
      let depth = 1;
      let pos = turnStart;
      let turnInner = '';
      while (depth > 0 && pos < inner.length) {
        const nextOpen = inner.indexOf('<div', pos);
        const nextClose = inner.indexOf('</div>', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            turnInner = inner.slice(turnStart, nextClose);
          }
          pos = nextClose + 6;
        }
      }

      // Extract <span class="it">...</span>
      const itSpanM = /<span\s[^>]*\bclass="[^"]*\bit\b[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(turnInner);
      if (!itSpanM) continue;
      const rawText = stripTags(itSpanM[1]);
      const text = stripGuillemets(rawText);
      if (!text) continue;

      segments.push({
        lang: 'it',
        text,
        voice: persona.voices.it,
        gapAfterMs: 1700,
        pitchSemitones: 0,
      });
      voiced++;
    }

    if (segments.length === 0) {
      process.stderr.write(`[bake-lesson-audio] dlg ${dlgId}: no persona-a turns found — skipping\n`);
      continue;
    }

    // Last segment gets 0 gap
    segments[segments.length - 1].gapAfterMs = 0;

    process.stderr.write(`[bake-lesson-audio] dlg ${dlgId}: voiced=${voiced} skipped(learner)=${skipped}\n`);
    totalVoiced += voiced;
    totalSkipped += skipped;

    dialogueArtifacts.push({
      kind: 'dialogue',
      sectionId: dlgId,
      // Pre-resolved: bypass resolveLecture
      _preResolved: true,
      segments,
      _voiced: voiced,
      _skipped: skipped,
    });
  }
}

// ---------------------------------------------------------------------------
// 2e — Optional lecture scripts from audio-scripts.json
// ---------------------------------------------------------------------------
const lectureArtifacts = [];
const audioScriptsPath = path.join(lessonDir, 'audio-scripts.json');
if (fs.existsSync(audioScriptsPath)) {
  try {
    const as = JSON.parse(fs.readFileSync(audioScriptsPath, 'utf8'));
    if (as.summary) lectureArtifacts.push({ kind: 'summary', segments: as.summary });
    if (as.shortened) lectureArtifacts.push({ kind: 'shortened', segments: as.shortened });
    if (as.sections) {
      for (const [sectionId, segs] of Object.entries(as.sections)) {
        lectureArtifacts.push({ kind: 'section', sectionId, segments: segs });
      }
    }
  } catch (e) {
    process.stderr.write(`[bake-lesson-audio] WARNING: could not parse audio-scripts.json: ${e.message}\n`);
  }
} else {
  process.stderr.write(`[bake-lesson-audio] audio-scripts.json not found — skipping lecture artifacts\n`);
}

// ---------------------------------------------------------------------------
// Step 3 — Resolve and assemble artifacts
// ---------------------------------------------------------------------------

// Artifacts that go through resolveLecture (need lang/gapAfter resolved → voice/gapAfterMs)
const toResolve = [
  ...phraseArtifacts,
  ...pearlArtifacts,
  ...storyArtifacts,
  ...lectureArtifacts,
];

let resolvedArtifacts = [];
if (toResolve.length > 0) {
  resolvedArtifacts = resolveLecture({ artifacts: toResolve }, domain);
}

// Dialogue artifacts are pre-resolved — strip the private bookkeeping fields before passing to bakeAudio
const preResolvedDialogues = dialogueArtifacts.map(({ _preResolved, _voiced, _skipped, ...rest }) => rest);

const allArtifacts = [...resolvedArtifacts, ...preResolvedDialogues];

// ---------------------------------------------------------------------------
// Dry-run: print plan and exit
// ---------------------------------------------------------------------------
if (dryRun) {
  process.stdout.write('\n=== bake-lesson-audio DRY RUN ===\n');
  process.stdout.write(`lesson-dir : ${lessonDir}\n`);
  process.stdout.write(`course-id  : ${courseId}\n`);
  process.stdout.write(`persona    : ${personaId}  domain: ${domain}  voices: ${Object.keys(voices).join(', ')}\n\n`);

  process.stdout.write('Artifacts to bake:\n');
  process.stdout.write('──────────────────────────────────────────────────────────\n');
  process.stdout.write(`${'kind'.padEnd(20)} ${'sectionId'.padEnd(30)} ${'segs'.padStart(4)}\n`);
  process.stdout.write('──────────────────────────────────────────────────────────\n');

  for (const art of allArtifacts) {
    process.stdout.write(`${art.kind.padEnd(20)} ${(art.sectionId ?? '(none)').padEnd(30)} ${String(art.segments.length).padStart(4)}\n`);
  }

  process.stdout.write('──────────────────────────────────────────────────────────\n');

  // Summary counts by kind
  const counts = {};
  for (const art of allArtifacts) {
    counts[art.kind] = (counts[art.kind] ?? 0) + 1;
  }
  process.stdout.write('\nSummary by kind:\n');
  for (const [kind, n] of Object.entries(counts)) {
    process.stdout.write(`  ${kind}: ${n}\n`);
  }
  process.stdout.write(`\nTotal artifacts: ${allArtifacts.length}\n`);

  // Dialogue detail
  if (dialogueArtifacts.length > 0) {
    process.stdout.write('\nDialogue voicing detail:\n');
    for (const dlg of dialogueArtifacts) {
      process.stdout.write(`  ${dlg.sectionId}: voiced=${dlg._voiced}  skipped(learner)=${dlg._skipped}\n`);
    }
    process.stdout.write(`  TOTAL voiced turns: ${totalVoiced}  skipped (data-learner): ${totalSkipped}\n`);
  }

  process.stdout.write('\n[dry-run] no bake performed.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 4 — Bake
// ---------------------------------------------------------------------------
// Init the SQLite db (idempotent)
initDb(lessonDir).close();

const results = await bakeAudio({
  lessonOutputDir: lessonDir,
  courseId,
  artifacts: allArtifacts,
  voices,
  ...(noQc ? { qc: false } : {}),
});

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
process.stdout.write('\n=== bake-lesson-audio RESULTS ===\n');
process.stdout.write('──────────────────────────────────────────────────────────\n');
process.stdout.write(`${'kind'.padEnd(20)} ${'sectionId'.padEnd(30)} ${'status'}\n`);
process.stdout.write('──────────────────────────────────────────────────────────\n');

let done = 0, reused = 0, failed = 0;
for (const r of results) {
  const sid = r.sectionId ?? '(none)';
  process.stdout.write(`${r.artifact.padEnd(20)} ${sid.padEnd(30)} ${r.status}\n`);
  if (r.status === 'done') done++;
  else if (r.status === 'reused') reused++;   // reused = already baked, not a failure
  else failed++;
}
process.stdout.write('──────────────────────────────────────────────────────────\n');
process.stdout.write(`Total: ${results.length}  baked: ${done}  reused: ${reused}  failed: ${failed}\n`);

if (dialogueArtifacts.length > 0) {
  process.stdout.write(`\nDialogue turns: voiced=${totalVoiced}  skipped(learner)=${totalSkipped}\n`);
}

// QC summary
const qcChecked = results.filter(r => r.status === 'done').length;
const qcWithDefects = results.filter(r => r.qcDefects && r.qcDefects.length > 0).length;
const qcReportWritten = qcWithDefects > 0;
if (!noQc) {
  process.stdout.write(
    `\nQC: ${qcChecked} clip(s) checked  ${qcWithDefects} with surviving defects` +
    `  re-baked: ${qcWithDefects > 0 ? qcWithDefects : 0}` +
    `  qc-report.json: ${qcReportWritten ? 'written' : 'not written (all clean)'}\n`
  );
}
