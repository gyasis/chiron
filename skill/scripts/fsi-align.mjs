#!/usr/bin/env node
/*
 * fsi-align.mjs — build a word-timing map for a baked FSI lesson, so the page can
 * light each word up exactly as Lucrezia says it (the karaoke / video-lesson effect).
 *
 *   node fsi-align.mjs <lesson-dir> [--only dlg-main]
 *   reads  <dir>/fsi.json + <dir>/audio/dialogue/*.mp3
 *   writes <dir>/audio/wordmap.js   -> window.__fsiWordMap = { "<clipId>": [ {w,s,e}, … ] }
 *
 * HOW THE TIMINGS ARE DERIVED (and the honest limits)
 * ---------------------------------------------------
 * The Atelier whisper sidecar (:8766) advertises a `word_timestamps` flag but returns
 * `words: null` — only SEGMENT-level start/end. Verified 2026-07-29. So:
 *
 *   1. ASR gives us accurate per-SEGMENT boundaries (one segment ≈ one spoken line).
 *   2. We do NOT trust ASR's transcript for the words themselves — we authored the
 *      script, so we already know them exactly, and ASR mis-hears proper nouns
 *      ("Ambasciata Americana") far more often than it mis-times a pause.
 *   3. Inside a segment, word times are interpolated by character weight, with
 *      punctuation given extra weight because a comma or full stop is where the
 *      speaker actually slows down.
 *
 * So: line boundaries are MEASURED, word boundaries within a line are ESTIMATED.
 * That is honest karaoke — the highlight never drifts out of its line, which is the
 * error that would actually be noticeable. If the sidecar ever returns real word
 * timings, `wordsFromSegment()` is the only function that needs replacing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ASR = process.env.CHIRON_ASR_URL || 'http://192.168.0.159:8766';
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node fsi-align.mjs <lesson-dir> [--only <clipId>]'); process.exit(1); }
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const L = JSON.parse(readFileSync(resolve(OUT, 'fsi.json'), 'utf8'));

/* The authored voiced lines per clip — the ground truth for WHAT is said. Mirrors the
   assembler's rule: persona-a is voiced, learner turns are not. */
function voicedLines(step) {
  switch (step.kind) {
    case 'dialog':    return (step.dialog?.turns || []).filter(t => t.who !== 'learner').map(t => t.it);
    case 'roleplay':  return (step.turns || []).filter(t => t.who !== 'learner').map(t => t.it);
    case 'repeat':    return (step.lines || []).map(l => l.it);
    case 'drill':     return (step.items || []).map(i => i.q);
    case 'variants':  return (step.items || []).map(i => i.cue);
    case 'interpret': return (step.items || []).map(i => i.it);
    case 'narrative': return [step.text];
    default:          return [];
  }
}

const clips = [];
for (const s of L.steps || []) {
  // `situations` carries its clips on the ITEMS, not the step — handle it before the
  // step-level id check, which would otherwise skip the whole step (it has no own id).
  if (s.kind === 'situations') {
    for (const it of s.items || []) {
      const l = (it.turns || []).filter(t => t.who !== 'learner').map(t => t.it);
      if (it.id && l.length) clips.push({ id: it.id, lines: l });
    }
    continue;
  }
  const id = s.dialog?.id || s.id;
  if (!id) continue;
  const lines = voicedLines(s);
  if (lines.length) clips.push({ id, lines });
}

/** Split one line into words with times spread across [start,end] by character weight.
 *  Punctuation carries extra weight — that is where a speaker actually slows down. */
function wordsFromSegment(line, start, end) {
  const toks = line.split(/\s+/).filter(Boolean);
  const weight = t => t.length + (/[,.;:!?…]$/.test(t) ? 3 : 0);
  const total = toks.reduce((a, t) => a + weight(t), 0) || 1;
  let acc = 0;
  return toks.map(t => {
    const s = start + (end - start) * (acc / total);
    acc += weight(t);
    const e = start + (end - start) * (acc / total);
    return { w: t, s: +s.toFixed(3), e: +e.toFixed(3) };
  });
}

async function transcribe(mp3) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(mp3)]), 'clip.mp3');
  fd.append('model', 'turbo');
  fd.append('language', 'it');
  const r = await fetch(`${ASR}/transcribe`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`ASR ${r.status}`);
  return r.json();
}

const map = {};
for (const c of clips) {
  if (only && c.id !== only) continue;
  const mp3 = resolve(OUT, 'audio/dialogue', `dlg-${c.id}.mp3`);
  if (!existsSync(mp3)) { console.log(`  ${c.id}: no mp3 — skipped`); continue; }
  try {
    const asr = await transcribe(mp3);
    const segs = (asr.segments || []).filter(s => (s.text || '').trim());
    // Align authored lines to ASR segments positionally. Counts normally match (one
    // segment per spoken line); when they don't, fall back to spreading the authored
    // lines evenly across the clip's duration rather than dropping the clip.
    // Emit LINE boundaries as well as words. The live-chat renderer needs to know when
    // each spoken line starts (to pop its bubble) — a flat word list can't express that.
    let words = [], linesOut = [];
    if (segs.length === c.lines.length) {
      c.lines.forEach((ln, i) => {
        const w = wordsFromSegment(ln, segs[i].start, segs[i].end);
        linesOut.push({ s: +segs[i].start.toFixed(3), e: +segs[i].end.toFixed(3), n: w.length });
        words = words.concat(w);
      });
    } else {
      // Counts differ (ASR split one authored line into several, or merged two).
      // Spread across the MEASURED span — segs[0].start .. last end — not from zero,
      // or every word drifts early by the clip's lead-in silence.
      const t0 = segs.length ? segs[0].start : 0;
      const t1 = segs.length ? segs[segs.length - 1].end : 0;
      const per = (t1 - t0) / c.lines.length;
      c.lines.forEach((ln, i) => {
        const a = t0 + i * per, b = t0 + (i + 1) * per;
        const w = wordsFromSegment(ln, a, b);
        linesOut.push({ s: +a.toFixed(3), e: +b.toFixed(3), n: w.length });
        words = words.concat(w);
      });
      console.log(`  ${c.id}: ⚠ ${segs.length} segments vs ${c.lines.length} authored line(s) — spread across ${t0.toFixed(1)}–${t1.toFixed(1)}s`);
    }
    map[c.id] = { words, lines: linesOut };
    console.log(`  ${c.id}: ${segs.length} segs, ${words.length} words, ${(segs[segs.length-1]?.end ?? 0).toFixed(1)}s`);
  } catch (e) {
    console.log(`  ${c.id}: FAILED (${e.message}) — lesson still works, karaoke just won't light up`);
  }
}

writeFileSync(resolve(OUT, 'audio/wordmap.js'),
  `window.__fsiWordMap = ${JSON.stringify(map)};\n`);
console.log(`→ ${Object.keys(map).length} clip(s) aligned → audio/wordmap.js`);
