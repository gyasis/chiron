#!/usr/bin/env node
/*
 * assemble-fsi.mjs — the FSI course assembler (v3 — conformed to the chiron shell).
 *
 *   node assemble-fsi.mjs <lesson-dir>
 *   reads  <dir>/fsi.json     the authored lesson (SCHEMA below)
 *   writes <dir>/lesson.html  + themes/ + clinical-widgets.css as siblings
 *
 * WHY v3 EXISTS
 * -------------
 * v2 hand-rolled its own CSS and its own audio player. It was *themed* (it read
 * --chiron-* tokens) but it was not a chiron lesson: no sidebar TOC, no scroll-spy, no
 * floating 🎧 panel, no reveal-EN buttons, none of the component library. It drifted.
 *
 * v3 uses the SAME shell as every other Italian lesson, by the same mechanism
 * assemble-language.mjs uses: a real built lesson is the DONOR for the <head> (all
 * component CSS) and the trailing scripts (audio panel, reveal-EN, theme switcher,
 * scroll-spy), then shell/main.js is appended. FSI's structure lives INSIDE that shell.
 *
 * So the rule is: use the native component for anything chiron already has —
 *   .v-table          vocabulary
 *   .turn persona-a/b dialogue turns (persona-a voiced, persona-b/data-learner never)
 *   .callout          grammar-pearl / cultural-note / tip
 *   .cloze-line       fill-in-the-blank (data-answer + .cloze-reveal-btn + .cloze-answer)
 *   .cold-open        the opening hook
 *   .lesson-section   every section, with a matching .toc-link
 * and only add FSI-specific CSS for the handful of exercise shapes chiron has no
 * component for (the model drill, variant lists, the interpreter list, situations).
 *
 * AUDIO — no custom player. Emitting `id="dlg-<id>"` on a dialogue container is enough:
 * shell/main.js finds it, wires an inline ▶, and the 🎧 panel groups it. Same convention
 * bake-lesson-audio.mjs reads, so authoring the anchor once serves both.
 *
 * SCHEMA — fsi.json  { lesson, title, titleIt, source:{book,pages}, persona, steps:[…] }
 *   prose | scene | listen | dialog | fill | vocab | notes | pearls
 *   repeat | drill | variants | interpret | roleplay | narrative | mcq | situations
 *   matchmadness   (delegated to fsi-match-madness.mjs)
 * See the renderers below for each one's fields.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMatchMadness } from './fsi-match-madness.mjs';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dirname, '..');
const HOME = process.env.HOME;
const REF = resolve(HOME, 'Documents/generated/chiron-italian-appunto/lesson.html');  // shell donor

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node assemble-fsi.mjs <lesson-dir>'); process.exit(1); }
const L = JSON.parse(readFileSync(resolve(OUT, 'fsi.json'), 'utf8'));

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const raw = s => String(s ?? '');
const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ── native chiron building blocks ──────────────────────────────────────────── */

const vturn = (label, it, en) =>
  `<div class="turn persona-a"${en ? ` data-en="${esc(en)}"` : ''}>` +
  `<span class="speaker">${esc(label)}</span><div class="what"><span class="it">${esc(it)}</span></div></div>`;

const lturn = (label, it, en) =>
  `<div class="turn persona-b" data-learner="true"${en ? ` data-en="${esc(en)}"` : ''}>` +
  `<span class="speaker">${esc(label)}</span><div class="what"><span class="it">${esc(it)}</span></div></div>`;

// id="dlg-<id>" is the audio anchor: main.js wires the inline ▶, the baker bakes it.
const dlg = (id, rows) => `<div class="dialogue" id="dlg-${esc(id)}">\n      ${rows.join('\n      ')}\n    </div>`;

const callout = (kind, tag, body, en) =>
  `<div class="callout ${kind}"${en ? ` data-en="${esc(en)}"` : ''}><span class="tag">${esc(tag)}</span> ${raw(body)}</div>`;

const lead = t => t ? `<p class="section-lead">${esc(t)}</p>` : '';

/* ── renderers ──────────────────────────────────────────────────────────────── */

const prose = s => raw(s.body);
const scene = s => callout('cultural-note', 'La scena', raw(s.text));

/* HEARING IT — books closed, and that is LITERAL. Audio and nothing else: no text, no
   reveal toggle, no karaoke. The whole point of the step is to guess meaning from sound
   alone, so anything readable on screen defeats it. The words belong to SEEING IT. */
const listen = s => `${lead(s.instruction)}
    ${callout('tip', 'Libri chiusi', 'Books closed. Press play and just listen — try to work out what is happening. The text comes in the next step.')}
    <div class="fsi-karaoke fsi-audioonly" data-clip="${esc(s.dialogRef || 'main')}">
      <div class="fsi-kbar"><button class="fsi-kplay" aria-label="Play">▶</button>
        <span class="fsi-kstatus">Ascolta</span></div>
    </div>`;

/* SEEING IT — "look at the dialog silently while listening". Rendered as a LIVE CHAT:
   the native chat markup (.chat-window/.chat-message/.chat-avatar/.chat-bubble, styled by
   clinical-widgets.css), but driven by the AUDIO CLOCK instead of the chat widget's own
   step-timer. Each bubble arrives when its line begins and the words inside light up as
   Lucrezia says them — reading a script and watching a conversation at the same time.

   The learner's turns are not in the audio, so they are timed into the GAP after the
   preceding spoken line. The exchange still reads as a real conversation, and nothing
   pretends Gyasi's lines were voiced. */
function chatBlock(id, turns, status) {
  const senders = [...new Set(turns.map(t => t.label))];
  const colorVar = l => `--chiron-avatar-${(senders.indexOf(l) % 6) + 1}`;
  let vi = -1;                                     // index among VOICED lines only
  const msgs = turns.map((t, i) => {
    const learner = t.who === 'learner';
    if (!learner) vi++;
    const body = learner ? esc(t.it)
      : t.it.split(/\s+/).map(w => `<span class="kw">${esc(w)}</span>`).join(' ');
    return `        <div class="chat-message${learner ? ' is-learner' : ''}" data-i="${i}"` +
      `${learner ? ' data-learner="true"' : ` data-voiced="${vi}"`}>` +
      `<div class="chat-avatar" style="background:var(${colorVar(t.label)},var(--chiron-accent))">${esc((t.label || '?')[0])}</div>` +
      `<div class="chat-bubble"><div class="chat-sender">${esc(t.label)}</div>` +
      `<p class="it">${body}</p>` +
      (t.en ? `<div class="chat-en"><span class="chat-en-tag">EN</span> ${esc(t.en)}</div>` : '') +
      `</div></div>`;
  }).join('\n');
  // The hidden .dialogue keeps the dlg-<id> audio anchor the baker + main.js read.
  return `<div class="fsi-chat" data-clip="${esc(id)}">
      <div class="fsi-kbar"><button class="fsi-kplay" aria-label="Play">\u25b6</button>
        <span class="fsi-kstatus">${esc(status || 'Guarda e ascolta')}</span>
        <button class="fsi-ktoggle" aria-pressed="false">Mostra tutto</button></div>
      <div class="chat-window"><div class="chat-messages">
${msgs}
      </div>
      </div>
    </div>
    <div class="fsi-voiceonly">${dlg(id, turns.map(t => t.who === 'learner'
      ? lturn(t.label, t.it, t.en) : vturn(t.label, t.it, t.en)))}</div>`;
}

function dialog(s) {
  const d = s.dialog || {};
  return `${lead(s.note)}
    ${chatBlock(d.id || 'main', d.turns || [])}
    <p class="hint">Bubbles arrive as they are spoken. Your lines (<em>Lei</em>) appear in turn but are never voiced.</p>`;
}

// Native .cloze-line, one per sentence. Multi-blank sentences keep every blank on the
// same line so a drill is never split across components.
function fill(s) {
  const lines = (s.items || []).map(it => {
    let k = 0;
    const html = esc(it.template).replace(/_{3,}/g, () => {
      const a = it.answers[k++] ?? '';
      return `<input type="text" placeholder="?" data-answer="${esc(a)}" data-expected="${esc(a)}" aria-label="blank">`;
    });
    return `      <div class="cloze-line" data-answer="${esc((it.answers || []).join(' · '))}">${html}
        <button class="cloze-reveal-btn">Mostra</button>
        <span class="cloze-answer">${esc((it.answers || []).join(' · '))}</span></div>`;
  }).join('\n');
  // The book's instruction is "listen to the dialog once more and fill in the blanks",
  // so the step needs the dialogue on hand — audio only, no text to copy from.
  return `${lead(s.instruction)}
    <div class="fsi-karaoke fsi-audioonly" data-clip="${esc(s.dialogRef || 'main')}">
      <div class="fsi-kbar"><button class="fsi-kplay" aria-label="Play">\u25b6</button>
        <span class="fsi-kstatus">Riascolta il dialogo</span></div>
    </div>
${lines}
    <div class="fsi-actions"><button class="fsi-check">Controlla</button><span class="fsi-score"></span></div>`;
}

/* PRONUNCIATION PRACTICE — deliberately NOT a chat. This is the one step whose job is
   your own mouth, so it is built around the microphone: hear Lucrezia say the line, say
   it back, and get scored on what actually came out. Per-line playback uses the wordmap
   line boundaries to seek inside the single baked clip. */
const repeat = s => `${lead(s.instruction)}
    <div class="fsi-pron" data-clip="${esc(s.id)}">
      ${(s.lines || []).map((l, i) => `
      <div class="fsi-pline" data-line="${i}" data-expected="${esc(l.it)}">
        <div class="fsi-prow">
          <button class="fsi-phear" title="Ascolta">\u25b6</button>
          <span class="it fsi-ptext">${esc(l.it)}</span>
          <button class="fsi-pmic" title="Parla">\u{1F3A4}</button>
        </div>
        ${l.en ? `<div class="gloss">${esc(l.en)}</div>` : ''}
        <div class="fsi-presult" hidden></div>
      </div>`).join('')}
      <p class="hint fsi-pnote">Press \u25b6 to hear the line, then \u{1F3A4} and say it back. You are scored on the words that actually came out.</p>
    </div>
    <div class="fsi-voiceonly">${dlg(s.id, (s.lines || []).map(l => vturn(l.label || 'Lucrezia', l.it, l.en)))}</div>`;

function drill(s) {
  const m = s.model || {};
  const list = (s.items || []).map(it =>
    `      <li><span class="it">${esc(it.q)}</span>` +
    `<span class="fsi-a" data-expected="${esc(it.a)}">${esc(it.a)}</span></li>`).join('\n');
  return `${lead(s.instruction)}
    ${callout('grammar-pearl', 'Modello', `<b>Q:</b> <span class="it">${esc(m.q)}</span><br><b>A:</b> <span class="it">${esc(m.a)}</span>`)}
    <ol class="fsi-list fsi-drill">\n${list}\n    </ol>
    <div class="fsi-actions"><button class="fsi-reveal">Mostra le risposte</button></div>
    <div class="fsi-voiceonly">${dlg(s.id, (s.items || []).map(it => vturn('Lucrezia', it.q, it.en)))}</div>`;
}

const variants = s => `${lead(s.instruction)}
    <ul class="fsi-list fsi-variants">${(s.items || []).map(v =>
      `<li><div class="it">${esc(v.cue)}</div>${v.en ? `<div class="gloss">${esc(v.en)}</div>` : ''}` +
      `<div class="fsi-a" data-expected="${esc(v.response)}">${esc(v.response)}</div></li>`).join('')}</ul>
    <div class="fsi-actions"><button class="fsi-reveal">Mostra le risposte possibili</button></div>
    <div class="fsi-voiceonly">${dlg(s.id, (s.items || []).map(v => vturn('Lucrezia', v.cue, v.en)))}</div>`;

const interpret = s => `${lead(s.instruction)}
    <ol class="fsi-list fsi-interp">${(s.items || []).map(v =>
      `<li><div class="it">${esc(v.it)}</div><div class="fsi-a" data-expected="${esc(v.en)}">${esc(v.en)}</div></li>`).join('')}</ol>
    <div class="fsi-actions"><button class="fsi-reveal">Mostra</button></div>
    <div class="fsi-voiceonly">${dlg(s.id, (s.items || []).map(v => vturn('Lucrezia', v.it, v.en)))}</div>`;

function roleplay(s) {
  const cues = (s.turns || []).filter(t => t.who === 'learner' && t.cue).map(t =>
    `<li><div class="cue">${esc(t.cue)}</div><div class="fsi-a" data-expected="${esc(t.it)}">${esc(t.it)}</div></li>`).join('');
  return `${lead(s.instruction)}
    ${s.setup ? callout('cultural-note', 'La situazione', raw(s.setup)) : ''}
    ${chatBlock(s.id, s.turns || [], 'Recita con Lucrezia')}
    ${cues ? `<ul class="fsi-list fsi-cues">${cues}</ul>
    <div class="fsi-actions"><button class="fsi-reveal">Mostra le mie battute</button></div>` : ''}`;
}

const narrative = s => `${lead(s.instruction)}
    ${dlg(s.id, [vturn('Lucrezia', s.text, s.en)])}
    ${callout('tip', 'Una volta sola', 'Listen once, answer the questions below, and only then reveal the English.')}`;

/* Listening Comprehension -> the NATIVE `mcq` widget (skill/lib/widget-renderer.ts),
   the same one the medicine and medical-Italian lessons use. One widget per FSI
   question: each carries its own stem, per-option correctness, and per-option
   explanation, so the learner gets the widget's built-in check + rationale rather than
   an FSI-local imitation of it. */
function mcq(s) {
  const widgets = (s.questions || []).map(q => renderWidget({
    type: 'mcq',
    stem: q.stem || `${q.n}.`,
    options: (q.options || []).map((o, i) => ({
      text: o,
      correct: q.answer === i,
      explanation: (q.why && q.why[i]) || '',
    })),
  })).join('\n    ');
  return `${lead(s.instruction)}
    <div class="fsi-mcq-stack">${widgets}</div>
    ${callout('cultural-note', 'Perché in inglese', 'FSI keeps these options in English on purpose — you are being tested on <em>understanding</em> what you heard, not on producing it.')}`;
}

const situations = s => `${lead(s.instruction)}
    <div class="fsi-sits">${(s.items || []).map((x, i) => {
      const cues = (x.turns || []).filter(t => t.who === 'learner').map(t =>
        `<li><div class="cue">${esc(t.cue || 'Il tuo turno')}</div>` +
        `<div class="fsi-a" data-expected="${esc(t.it)}"><span class="it">${esc(t.it)}</span>` +
        `${t.en ? ` <span class="gloss">${esc(t.en)}</span>` : ''}</div></li>`).join('');
      return `<details class="fsi-sit"${i === 0 ? ' open' : ''}>
      <summary><span class="fsi-sit-n">${i + 1}</span> ${esc(x.title)} <span class="fsi-sit-lv">${esc(x.level || '')}</span></summary>
      <div class="fsi-sit-body">
        ${callout('cultural-note', 'La situazione', raw(x.setup))}
        ${chatBlock(x.id, x.turns || [], 'Ascolta la scena')}
        ${cues ? `<ul class="fsi-list fsi-cues">${cues}</ul>
        <div class="fsi-actions"><button class="fsi-reveal">Mostra le mie battute</button></div>` : ''}
      </div></details>`;
    }).join('\n    ')}</div>`;

const vocab = s => `${lead(s.note)}<table class="v-table"><thead><tr><th>Italiano</th><th>English</th><th>Note</th></tr></thead><tbody>
    ${(s.items || []).map(v => `<tr><td id="vocab-${slug(v.it)}" class="it">${esc(v.it)}</td><td>${esc(v.en)}</td><td class="ex">${raw(v.note)}</td></tr>`).join('\n    ')}
    </tbody></table>`;

const notes = s => `<ol class="fsi-list">${(s.items || []).map(n => `<li>${raw(n)}</li>`).join('')}</ol>`;

const pearls = s => (s.items || []).map(p =>
  `<div class="callout grammar-pearl" id="pearl-${slug((p.en || '').slice(0, 28))}" data-en="${esc(p.en)}">` +
  `<span class="tag">Perla di grammatica</span> ${raw(p.it)}</div>`).join('\n');

/* USING IT (live) — a real conversation with an agent, not a script.
   The agent plays the Italian speaker in the scene and improvises; you answer by voice
   (it-IT speech-to-text) or by typing. Every turn is captured, and at the end a SECOND
   pass grades the transcript: what you said, what you should have said, what landed.
   Backed by the chiron tutor service (:8912 /tutor-chat) — the same PromptChain service
   the in-lesson tutor uses, so there is no new backend to run. */
const conversation = s => `${lead(s.instruction)}
    ${s.setup ? callout('cultural-note', 'La situazione', raw(s.setup)) : ''}
    <div class="fsi-live" data-endpoint="${esc(s.endpoint || 'http://127.0.0.1:8912/tutor-chat')}"
         data-role="${esc(s.role || 'un agente della polizia di frontiera')}"
         data-goal="${esc(s.goal || '')}"
         data-lesson="${esc(L.titleIt || L.title)}">
      <div class="fsi-live-log" aria-live="polite"></div>
      <div class="fsi-live-bar">
        <button class="fsi-live-start">Inizia la conversazione</button>
        <button class="fsi-live-mic" hidden title="Parla">\u{1F3A4}</button>
        <input class="fsi-live-text" hidden placeholder="…oppure scrivi qui e premi Invio">
        <button class="fsi-live-end" hidden>Termina e valuta</button>
      </div>
      <div class="fsi-live-grade" hidden></div>
    </div>`;

const matchmadness = s => `${lead(s.instruction)}${renderMatchMadness({
  id: s.id || 'mm', title: s.title || 'Match Madness',
  timerSec: s.timerSec ?? 120, sets: s.sets || [] })}`;

const RENDER = { prose, scene, listen, dialog, fill, vocab, notes, pearls, repeat, drill,
                 variants, interpret, roleplay, narrative, mcq, situations, matchmadness, conversation };

/* ── page ───────────────────────────────────────────────────────────────────── */

const steps = (L.steps || []).map((s, i) => ({ ...s, sid: `step-${i + 1}` }));

const sections = steps.map((s, i) => {
  const fn = RENDER[s.kind];
  if (!fn) { console.error(`  ! unknown kind '${s.kind}' (${s.sid}) — skipped`); return ''; }
  return `    <section class="lesson-section" id="${s.sid}">
      <h2 class="section-h"><span class="sec-n">${i + 1}</span> ${esc(s.title || s.step)}</h2>
      ${s.note && s.kind !== 'dialog' && s.kind !== 'vocab' ? `<p class="section-lead">${raw(s.note)}</p>` : ''}
      ${fn(s)}
    </section>`;
}).filter(Boolean).join('\n');

const tocLinks = steps.map((s, i) =>
  `      <a class="toc-link" href="#${s.sid}" data-toc-target="${s.sid}"><span class="toc-num">${i + 1}.</span><span class="toc-title">${esc(s.title || s.step)}</span></a>`
).join('\n');

const body = `
  <aside class="side" aria-label="Table of contents">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">Italiano · FSI<br>Lezione ${esc(L.lesson)} — ${esc(L.title)}</div>
    <div class="toc-header">Sezioni</div>
    <nav class="toc-nav" aria-label="Lesson sections">
${tocLinks}
    </nav>
    <div class="toc-header theme-section">Tema</div>
    <nav class="theme-bar theme-section" aria-label="Theme">
      <button data-set-theme="linguistic" aria-pressed="true">linguistic</button>
      <button data-set-theme="warm-paper">warm</button>
      <button data-set-theme="clinical">clinical</button>
      <button data-set-theme="midnight">midnight</button>
      <button data-set-theme="ocean">ocean</button>
    </nav>
  </aside>

  <main class="main" id="main-content">
  <div class="lesson-shell">
    <header class="lesson-header">
      <div class="eyebrow">Chiron · Italiano · FSI FAST · Lezione ${esc(L.lesson)}</div>
      <h1 class="lesson-title">${esc(L.titleIt || L.title)}</h1>
      <p class="subtitle">${esc(L.title)} · ${esc(L.source?.book || '')}${L.source?.pages ? `, pp. ${L.source.pages[0]}–${L.source.pages[1]}` : ''}</p>
    </header>
    ${L.coldOpen ? `<div class="cold-open" data-en="${esc(L.coldOpen.en)}"><span class="it">${esc(L.coldOpen.it)}</span></div>` : ''}
${sections}
    <footer class="lesson-footer">Chiron · Italiano · FSI · Lucrezia</footer>
  </div></main>`;

/* FSI-only CSS — ONLY the exercise shapes chiron has no component for. Everything else
   (v-table, turn, callout, cloze, cold-open, TOC, header) comes from the donor head. */
const FSI_CSS = `
/* Headers match the normal Italian lessons: a quiet number + the title. NO pill.
   A badge on every section is noise — in chiron a pill means "this block is special"
   (grammar pearl, cultural note), so badging all 23 headers destroyed that signal and
   repeated the same label three times running. The step order lives in the TOC. */
.sec-n{color:var(--chiron-muted);font-weight:400;margin-right:.35rem}
.fsi-list{margin:.6rem 0;padding-left:1.2rem}
.fsi-list li{margin:.45rem 0}
.fsi-drill li{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.fsi-a{color:var(--chiron-accent);font-weight:600;visibility:hidden}
.fsi-a.shown{visibility:visible}
.fsi-variants>li,.fsi-interp>li,.fsi-cues>li{border-bottom:1px solid var(--chiron-divider);padding-bottom:.45rem}
.fsi-cues{list-style:none;padding-left:0}
.fsi-cues .cue,.fsi-variants .gloss{color:var(--chiron-muted);font-size:.88em}
.fsi-opts{margin:.3rem 0 .9rem 1.1rem}
.fsi-opts label{cursor:pointer}
.fsi-opts li.ok>label{color:var(--chiron-success);font-weight:600}
.fsi-opts li.bad>label{color:var(--chiron-error)}
.fsi-actions{display:flex;gap:.5rem;align-items:center;margin:.7rem 0 .2rem;flex-wrap:wrap}
.fsi-actions button{font:inherit;font-size:.82rem;border:1px solid var(--chiron-border);
 background:var(--chiron-surface);color:var(--chiron-fg-secondary);border-radius:var(--chiron-radius-sm,6px);
 padding:.28rem .8rem;cursor:pointer}
.fsi-actions button:hover{background:var(--chiron-elevated)}
.fsi-score{font-weight:600;color:var(--chiron-accent)}
.fsi-voiceonly{display:none}
.fsi-mcq-stack{display:flex;flex-direction:column;gap:.9rem}
/* karaoke */
/* Players are a BAR, not a card. A white --chiron-surface panel on the cream page reads
   as a foreign box; the lesson's own texture is hairlines and open space. */
.fsi-karaoke{margin:.4rem 0 .9rem}
.fsi-kbar{display:flex;align-items:center;gap:.7rem;margin:0 0 .5rem;
 padding:.15rem 0 .5rem;border-bottom:1px solid var(--chiron-divider)}
.fsi-audioonly{margin:.3rem 0 1rem}
.fsi-audioonly .fsi-kbar{border-bottom:none;padding-bottom:0;margin-bottom:0}
.fsi-kplay{font:inherit;min-width:2.5rem;border:1px solid var(--chiron-accent);background:transparent;
 color:var(--chiron-accent);border-radius:5px;padding:.25rem .6rem;cursor:pointer}
.fsi-kplay:hover{background:var(--chiron-accent);color:var(--chiron-bg)}
.fsi-kstatus{color:var(--chiron-muted);font-size:.86rem;flex:1}
.fsi-ktoggle{font:inherit;font-size:.78rem;border:1px solid var(--chiron-border);background:transparent;
 color:var(--chiron-muted);border-radius:5px;padding:.2rem .6rem;cursor:pointer}
.fsi-kwords{display:flex;flex-direction:column;gap:.45rem;line-height:2}
.kw-line{display:block}
.kw{display:inline-block;padding:0 .12em;border-radius:3px;
 color:transparent;background:color-mix(in srgb,var(--chiron-muted) 22%,transparent);
 transition:color .18s ease,background .18s ease,transform .18s ease}
/* revealed = text visible but not yet spoken */
.fsi-karaoke.shown .kw{color:var(--chiron-fg-secondary);background:transparent}
/* spoken already */
.kw.done{color:var(--chiron-fg-secondary);background:transparent}
/* the word being said right now — flash + grow */
.kw.live{color:var(--chiron-accent);background:color-mix(in srgb,var(--chiron-accent) 16%,transparent);
 transform:scale(1.14);font-weight:600}
@media(prefers-reduced-motion:reduce){.kw{transition:none}.kw.live{transform:none}}
/* USING IT — live agent conversation */
.fsi-live{margin:.5rem 0 1rem}
.fsi-live-log{display:flex;flex-direction:column;gap:.5rem;margin-bottom:.6rem}
.fsi-live-log:empty{display:none}
.fsi-live-msg{display:flex;gap:.6rem;align-items:flex-start}
.fsi-live-msg.me{flex-direction:row-reverse}
.fsi-live-msg .who{flex:none;width:2rem;height:2rem;border-radius:50%;display:flex;
 align-items:center;justify-content:center;font-weight:700;font-size:.8rem;
 background:var(--chiron-accent);color:var(--chiron-bg)}
.fsi-live-msg.me .who{background:var(--chiron-warm-accent)}
.fsi-live-msg .say{background:var(--chiron-elevated);border:1px solid var(--chiron-divider);
 border-radius:12px;padding:.5rem .8rem;max-width:min(46ch,80%)}
.fsi-live-msg.me .say{background:color-mix(in srgb,var(--chiron-accent) 12%,var(--chiron-surface))}
.fsi-live-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.fsi-live-bar button{font:inherit;font-size:.84rem;border:1px solid var(--chiron-accent);
 background:transparent;color:var(--chiron-accent);border-radius:5px;padding:.3rem .8rem;cursor:pointer}
.fsi-live-bar button:hover{background:var(--chiron-accent);color:var(--chiron-bg)}
.fsi-live-mic.rec{background:var(--chiron-error);border-color:var(--chiron-error);color:var(--chiron-bg)}
.fsi-live-text{flex:1;min-width:14rem;font:inherit;padding:.32rem .6rem;border-radius:5px;
 border:1px solid var(--chiron-border);background:var(--chiron-surface);color:var(--chiron-fg)}
.fsi-live-grade{margin-top:.9rem;padding:.85rem 1rem;border-radius:8px;
 background:color-mix(in srgb,var(--chiron-accent) 7%,transparent);border:1px solid var(--chiron-divider)}
.fsi-live-grade h4{margin:.1rem 0 .5rem;font-family:var(--chiron-font-heading)}
/* pronunciation practice — mic-first */
.fsi-pline{border-bottom:1px solid var(--chiron-divider);padding:.55rem 0}
.fsi-prow{display:flex;align-items:center;gap:.7rem}
.fsi-ptext{flex:1}
.fsi-phear,.fsi-pmic{font:inherit;font-size:.9rem;border:1px solid var(--chiron-border);
 background:transparent;color:var(--chiron-accent);border-radius:5px;padding:.18rem .55rem;cursor:pointer}
.fsi-phear:hover,.fsi-pmic:hover{background:var(--chiron-elevated)}
.fsi-pmic.rec{background:var(--chiron-error);color:var(--chiron-bg);border-color:var(--chiron-error)}
.fsi-presult{margin-top:.35rem;font-size:.88rem}
.fsi-presult .ok{color:var(--chiron-success);font-weight:600}
.fsi-presult .miss{color:var(--chiron-error);text-decoration:line-through}
.fsi-pscore{font-weight:700;margin-right:.5rem}
.fsi-pheard{color:var(--chiron-muted);font-style:italic}
/* live chat (SEEING IT) — bubbles are hidden until their line is spoken */
/* Override the donor .chat-window card: before the first bubble arrives there must be
   NOTHING on screen — an empty white panel was the single ugliest thing on the page. */
.fsi-chat .chat-window{max-height:none;min-height:0;padding:0;margin:0;
 background:transparent;border:0;box-shadow:none;overflow:visible}
.fsi-chat .chat-messages{background:transparent;border:0;padding:0;margin:0;min-height:0}
/* Undelivered bubbles are display:none — NOT opacity:0 — so the window GROWS as the
   conversation arrives instead of showing pre-reserved empty gaps. */
.fsi-chat .chat-message{display:none;gap:.6rem;align-items:flex-start;margin:.5rem 0}
.fsi-chat .chat-message.in,.fsi-chat.shown .chat-message{display:flex;animation:fsiPop .3s ease both}
@keyframes fsiPop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* your turn: the conversation waits for you */
.fsi-chat .chat-message.is-learner.waiting .chat-bubble{outline:2px dashed var(--chiron-accent);outline-offset:3px}
.fsi-chat .fsi-yourturn{display:none;align-items:center;gap:.6rem;margin:.6rem 0 .2rem;
 padding:.5rem .8rem;border-radius:8px;background:color-mix(in srgb,var(--chiron-accent) 10%,transparent)}
.fsi-chat.waiting .fsi-yourturn{display:flex}
.fsi-chat .fsi-yourturn span{color:var(--chiron-fg-secondary);font-size:.88rem;flex:1}
.fsi-chat .fsi-continue{font:inherit;font-size:.82rem;border:1px solid var(--chiron-accent);
 background:var(--chiron-accent);color:var(--chiron-bg);border-radius:5px;padding:.28rem .85rem;cursor:pointer}
.fsi-chat .chat-message.is-learner{flex-direction:row-reverse}
.fsi-chat .chat-message.is-learner .chat-bubble{background:color-mix(in srgb,var(--chiron-accent) 12%,var(--chiron-surface))}
.fsi-chat .chat-avatar{flex:none;width:2rem;height:2rem;border-radius:50%;color:var(--chiron-bg);
 display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem}
.fsi-chat .chat-bubble{background:var(--chiron-elevated);border-radius:12px;
 padding:.5rem .8rem;max-width:min(46ch,80%);border:1px solid var(--chiron-divider)}
.fsi-chat .chat-sender{font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;
 color:var(--chiron-muted);font-weight:700;margin-bottom:.15rem}
.fsi-chat .chat-bubble p{margin:0}
.fsi-chat .chat-en{margin-top:.3rem;font-size:.85rem;color:var(--chiron-muted);font-style:italic;
 opacity:0;max-height:0;overflow:hidden;transition:opacity .2s ease,max-height .2s ease}
.fsi-chat.shown .chat-en,.fsi-chat .chat-message:hover .chat-en{opacity:1;max-height:6rem}
.fsi-chat .chat-en-tag{font-style:normal;font-weight:700;font-size:.66rem;color:var(--chiron-accent);margin-right:.3rem}
/* in the chat, unspoken words stay readable — the highlight tracks, it does not hide */
.fsi-chat .kw{color:inherit;background:transparent}

.cloze-line input.ok{border-color:var(--chiron-success)}
.cloze-line input.bad{border-color:var(--chiron-error)}
.fsi-sits{display:flex;flex-direction:column;gap:.55rem}
.fsi-sit{border:1px solid var(--chiron-border);border-radius:var(--chiron-radius-sm,8px);background:var(--chiron-surface)}
.fsi-sit>summary{cursor:pointer;padding:.65rem .85rem;font-weight:600;list-style:none;display:flex;align-items:center;gap:.55rem}
.fsi-sit>summary::-webkit-details-marker{display:none}
.fsi-sit>summary::after{content:'▾';margin-left:auto;color:var(--chiron-muted)}
.fsi-sit[open]>summary::after{content:'▴'}
.fsi-sit[open]>summary{border-bottom:1px solid var(--chiron-border)}
.fsi-sit-n{display:inline-flex;align-items:center;justify-content:center;width:1.45rem;height:1.45rem;
 border-radius:50%;background:var(--chiron-accent);color:var(--chiron-bg);font-size:.74rem;flex:none}
.fsi-sit-lv{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--chiron-muted)}
.fsi-sit-body{padding:.85rem}
`;

const FSI_JS = `
/* karaoke: drive .kw highlighting off the audio clock (timeupdate is throttled to ~4Hz,
   so we use rAF while playing for a highlight that lands on the word, not after it). */
// The donor loads audio/manifest.js with defer, so it has NOT executed while this
// inline end-of-body script is parsed. Deferred scripts finish before DOMContentLoaded,
// so waiting for that event is what makes the manifest reliably present.
document.addEventListener('DOMContentLoaded', function(){
  var man=(window.__chironAudioManifest||{}).clips||[], map=window.__fsiWordMap||{};
  var players=[];
  function clipFor(id){ return man.find(function(c){return c.sectionId===id||c.sectionId==='dlg-'+id;}); }

    // ── USING IT: live agent conversation + after-session grading ───────────────
  document.querySelectorAll('.fsi-live').forEach(function(box){
    var url=box.dataset.endpoint, log=box.querySelector('.fsi-live-log');
    var bStart=box.querySelector('.fsi-live-start'), bMic=box.querySelector('.fsi-live-mic');
    var inp=box.querySelector('.fsi-live-text'), bEnd=box.querySelector('.fsi-live-end');
    var grade=box.querySelector('.fsi-live-grade');
    var SRl=window.SpeechRecognition||window.webkitSpeechRecognition;
    var history=[];                                  // [{role, content}] — the transcript

    var SYS='Sei '+box.dataset.role+' in una scena di italiano pratico ('+box.dataset.lesson+'). '
      +'Parla SOLO italiano, frasi brevi e naturali da conversazione reale. Una battuta alla volta. '
      +'Non correggere gli errori adesso e non spiegare la grammatica: stai avendo una conversazione. '
      +(box.dataset.goal?('Obiettivo della scena: '+box.dataset.goal+'. '):'')
      +'Inizia tu, con una sola battuta.';

    function bubble(who,text,me){
      var d=document.createElement('div');
      d.className='fsi-live-msg'+(me?' me':'');
      d.innerHTML='<div class="who">'+who+'</div><div class="say"></div>';
      d.querySelector('.say').textContent=text;
      log.appendChild(d); d.scrollIntoView({block:'nearest'});
    }
    async function ask(messages, extraText){
      var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({section_text:extraText||SYS, selection:'', section_id:'using-it',
          lesson_slug:box.dataset.lesson, messages:messages, lang:'it', mode:'lang'})});
      if(!r.ok) throw new Error('tutor '+r.status);
      var j=await r.json();
      if(j.error) throw new Error(j.error);
      return (j.reply||'').trim();
    }
    async function agentTurn(){
      bStart.disabled=true;
      try{ var reply=await ask(history.concat([{role:'user',content:'(continua la scena)'}]));
        history.push({role:'assistant',content:reply}); bubble('L',reply,false); }
      catch(e){ bubble('!','[agente non raggiungibile: '+e.message+']',false); }
      bStart.disabled=false;
    }
    function say(text){
      if(!text.trim())return;
      history.push({role:'user',content:text}); bubble('Tu',text,true); agentTurn();
    }
    bStart.addEventListener('click',async function(){
      bStart.hidden=true; bEnd.hidden=false; inp.hidden=false;
      if(SRl) bMic.hidden=false;
      await agentTurn();
    });
    if(SRl) bMic.addEventListener('click',function(){
      var rec=new SRl(); rec.lang='it-IT'; rec.interimResults=false;
      bMic.classList.add('rec');
      rec.onend=function(){bMic.classList.remove('rec');};
      rec.onerror=function(){bMic.classList.remove('rec');};
      rec.onresult=function(ev){ say(ev.results[0][0].transcript||''); };
      rec.start();
    });
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ say(inp.value); inp.value=''; } });
    bEnd.addEventListener('click',async function(){
      bEnd.disabled=true; grade.hidden=false; grade.textContent='Valutazione in corso…';
      var script=history.map(function(m){return (m.role==='user'?'IO: ':'AGENTE: ')+m.content;}).join('\\n');
      var prompt='Sei un insegnante di italiano. Qui sotto la trascrizione di una conversazione '
        +'praticata da uno studente anglofono (livello principiante, lezione: '+box.dataset.lesson+'). '
        +'Valuta SOLO le battute marcate IO. Rispondi in inglese, conciso, in questo formato:\\n'
        +'1) What you said well — bullet list.\\n2) Errors — for each: what you said, what it should be, why.\\n'
        +'3) What you could have said instead — 2-3 more natural alternatives.\\n4) One thing to practise next.\\n\\n'
        +'TRASCRIZIONE:\\n'+script;
      try{ var out=await ask([{role:'user',content:prompt}], prompt);
        grade.innerHTML='<h4>Valutazione</h4>'+out.replace(/&/g,'&amp;').replace(/</g,'&lt;')
          .replace(/\\n/g,'<br>'); }
      catch(e){ grade.textContent='Valutazione non disponibile ('+e.message+')'; }
      bEnd.disabled=false;
    });
  });

  // ── pronunciation practice: per-line playback + speech scoring ──────────────
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  document.querySelectorAll('.fsi-pron').forEach(function(box){
    var id=box.dataset.clip, data=map[id]||{}, lines=data.lines||[], clip=clipFor(id);
    var audio=clip&&clip.status==='done'?new Audio(clip.audioPath):null;
    if(!SR){ var n=box.querySelector('.fsi-pnote');
      if(n) n.textContent='Speech input needs Chrome or Edge — playback still works.'; }
    box.querySelectorAll('.fsi-pline').forEach(function(row){
      var i=+row.dataset.line, want=row.dataset.expected;
      var hear=row.querySelector('.fsi-phear'), mic=row.querySelector('.fsi-pmic'), out=row.querySelector('.fsi-presult');
      // seek to this line inside the single baked clip and stop at its end
      hear.addEventListener('click',function(){
        if(!audio||!lines[i]) return;
        players.forEach(function(x){x.pause();}); audio.pause();
        audio.currentTime=lines[i].s; audio.play();
        var stop=function(){ if(audio.currentTime>=lines[i].e){ audio.pause();
          audio.removeEventListener('timeupdate',stop); } };
        audio.addEventListener('timeupdate',stop);
      });
      if(!SR){ mic.style.display='none'; return; }
      mic.addEventListener('click',function(){
        var rec=new SR(); rec.lang='it-IT'; rec.interimResults=false; rec.maxAlternatives=3;
        mic.classList.add('rec'); out.hidden=false; out.textContent='In ascolto…';
        rec.onerror=function(e){ mic.classList.remove('rec');
          out.textContent = e.error==='not-allowed' ? 'Microphone permission denied.' : 'Non ho sentito — riprova.'; };
        rec.onend=function(){ mic.classList.remove('rec'); };
        rec.onresult=function(ev){
          var heard=ev.results[0][0].transcript||'';
          var norm=function(x){return x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9' ]/g,' ').trim().split(/\s+/).filter(Boolean);};
          var W=norm(want), H=norm(heard), pool=H.slice(), marks=[], hit=0;
          W.forEach(function(w){ var k=pool.indexOf(w);
            if(k>-1){ pool.splice(k,1); hit++; marks.push('<span class="ok">'+w+'</span>'); }
            else marks.push('<span class="miss">'+w+'</span>'); });
          var pct=W.length?Math.round(hit/W.length*100):0;
          out.innerHTML='<span class="fsi-pscore">'+pct+'%</span>'+marks.join(' ')+
            '<div class="fsi-pheard">ho sentito: “'+heard+'”</div>';
        };
        rec.start();
      });
    });
  });

  document.querySelectorAll('.fsi-karaoke, .fsi-chat').forEach(function(box){
    var id=box.dataset.clip, data=map[id]||{}, words=data.words||[], lines=data.lines||[];
    var clip=clipFor(id);
    var btn=box.querySelector('.fsi-kplay'), st=box.querySelector('.fsi-kstatus'), tg=box.querySelector('.fsi-ktoggle');
    var kws=[].slice.call(box.querySelectorAll('.kw'));
    var msgs=[].slice.call(box.querySelectorAll('.chat-message'));

    if(tg) tg.addEventListener('click',function(){
      var on=box.classList.toggle('shown');
      tg.setAttribute('aria-pressed',String(on));
      tg.textContent=on?'Nascondi':'Mostra tutto';
    });
    if(!clip||clip.status!=='done'){ st.textContent='(audio non disponibile)'; btn.disabled=true; return; }

    // Bubble reveal times: a voiced bubble appears when its line starts; a learner
    // bubble appears in the GAP right after the preceding spoken line ends.
    var showAt=msgs.map(function(m){
      var v=m.getAttribute('data-voiced');
      if(v!==null&&lines[+v]) return lines[+v].s;
      var prev=+m.dataset.i-1, pv=null;
      for(var k=prev;k>=0;k--){ var mm=msgs[k], vv=mm&&mm.getAttribute('data-voiced');
        if(vv!==null&&lines[+vv]){ pv=lines[+vv].e; break; } }
      // Schedule the learner's turn EXACTLY at the previous line's end. Whisper reports
      // adjacent segments with no gap (prevEnd === nextStart), so any positive offset
      // would place your bubble AFTER the next speaker had already begun.
      return pv===null?0:pv;
    });

    var a=new Audio(clip.audioPath), raf=0;
    players.push(a);
    function paint(){
      var t=a.currentTime, live=-1;
      for(var i=0;i<words.length&&i<kws.length;i++){
        if(t>=words[i].s&&t<words[i].e) live=i;
        kws[i].classList.toggle('done', t>=words[i].e);
      }
      kws.forEach(function(k,i){k.classList.toggle('live', i===live);});
      // Find the first learner turn that is due but not yet spoken. Nothing PAST it may
      // be revealed — otherwise the next Agente bubble pops in the same frame as the
      // pause and the learner's turn gets no beat at all (the bug this fixes).
      var stopAt=msgs.length;
      if(box.classList.contains('fsi-chat')){
        for(var j=0;j<msgs.length;j++){
          if(msgs[j].dataset.learner==='true'&&!msgs[j].classList.contains('said')&&t>=showAt[j]){ stopAt=j; break; }
        }
      }
      msgs.forEach(function(m,i){ if(i<=stopAt&&t>=showAt[i]) m.classList.add('in'); });
      if(stopAt<msgs.length&&!a.paused&&!box.__holding){
        // The learner's line is not in the audio and whisper leaves no gap between
        // spoken lines, so we MINT the beat: hold for roughly as long as the line takes
        // to say, then resume on our own. No button — it should feel conversational.
        var el=msgs[stopAt], txt=(el.querySelector('p')||{}).textContent||'';
        var hold=Math.min(3.5, Math.max(0.8, 0.5 + txt.trim().split(/\s+/).length*0.38));
        a.pause(); el.classList.add('in','waiting'); box.__holding=true;
        if(st) st.textContent='Tocca a te…';
        setTimeout(function(){
          el.classList.add('said'); el.classList.remove('waiting'); box.__holding=false;
          if(st) st.textContent='In ascolto…';
          a.play(); btn.textContent='\u275a\u275a'; raf=requestAnimationFrame(paint);
        }, hold*1000);
        return;
      }
      if(!a.paused) raf=requestAnimationFrame(paint);
    }
    btn.addEventListener('click',function(){
      if(a.paused){ players.forEach(function(x){ if(x!==a) x.pause(); });
        a.play(); btn.textContent='\u275a\u275a'; st.textContent='In ascolto…'; raf=requestAnimationFrame(paint); }
      else a.pause();
    });
    a.addEventListener('pause',function(){ btn.textContent='\u25b6'; cancelAnimationFrame(raf); });
    btn.addEventListener('click',function(){ if(!a.paused) box.__holding=false; });
    a.addEventListener('ended',function(){
      btn.textContent='\u25b6'; cancelAnimationFrame(raf); box.__holding=false;
      kws.forEach(function(k){k.classList.remove('live');});
      // Don't dump the remaining bubbles at once — the conversation usually ends on the
      // learner's line, which has no audio. Reveal the stragglers in rhythm, using the
      // same say-it-out-loud pacing, so the tail lands like the rest of the exchange.
      var rest=msgs.filter(function(m){return !m.classList.contains('in');});
      if(!rest.length){ st.textContent='Di nuovo?'; return; }
      st.textContent='Tocca a te…';
      var d=0;
      rest.forEach(function(m){
        var txt=(m.querySelector('p')||{}).textContent||'';
        d+=Math.min(3.5,Math.max(0.8,0.5+txt.trim().split(/\s+/).length*0.38));
        setTimeout(function(){ m.classList.add('in'); },d*1000);
      });
      setTimeout(function(){ st.textContent='Di nuovo?'; },d*1000+400);
    });
  });
});
(function(){
  var norm=function(s){return (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9' ]/g,'').trim();};
  document.querySelectorAll('.lesson-section').forEach(function(sec){
    var rev=sec.querySelector('.fsi-reveal'), chk=sec.querySelector('.fsi-check'), sc=sec.querySelector('.fsi-score');
    if(rev) rev.addEventListener('click',function(){
      sec.querySelectorAll('.fsi-a').forEach(function(a){a.classList.add('shown');});
      sec.querySelectorAll('.fsi-q').forEach(function(q){
        var w=q.dataset.answer; if(w!=='') q.querySelectorAll('.fsi-opts li')[+w].classList.add('ok');});
    });
    if(chk) chk.addEventListener('click',function(){
      var ok=0,tot=0;
      sec.querySelectorAll('.cloze-line input[data-answer]').forEach(function(b){
        tot++; var good=norm(b.value)===norm(b.dataset.answer);
        b.classList.toggle('ok',good); b.classList.toggle('bad',!good); if(good)ok++;});
      sec.querySelectorAll('.fsi-q').forEach(function(q){
        tot++; var want=q.dataset.answer===''?null:+q.dataset.answer, got=q.querySelector('input:checked');
        if(want===null)return;
        q.querySelectorAll('.fsi-opts li').forEach(function(li,i){
          li.classList.toggle('ok',i===want);
          li.classList.toggle('bad',!!got&&+got.value===i&&i!==want);});
        if(got&&+got.value===want)ok++;});
      if(sc) sc.textContent=ok+' / '+tot;
    });
  });
})();
`;

/* ── donor shell: same mechanism assemble-language.mjs uses ─────────────────── */
const ref = readFileSync(REF, 'utf8');
let head = ref.slice(0, ref.indexOf('</head>') + 7)
  .replace(/<title>[\s\S]*?<\/title>/, `<title>Chiron · FSI ${esc(L.lesson)} — ${esc(L.title)}</title>`);
if (!head.includes('clinical-widgets.css')) {
  head = head.replace('</head>', '  <link rel="stylesheet" href="clinical-widgets.css">\n</head>');
}
// wordmap.js sets window.__fsiWordMap (karaoke timings). NOT deferred — FSI_JS runs at
// end-of-body and reads it synchronously; a deferred script would still be pending.
head = head.replace('</head>',
  `  <script src="audio/wordmap.js"></script>\n  <style>${FSI_CSS}</style>\n</head>`);

const sIdx = ref.indexOf('<!-- ', ref.indexOf('</main>'));
const scripts = sIdx > 0 ? ref.slice(sIdx) : ref.slice(ref.indexOf('</main>') + 7);
let shellEngine = '';
try { shellEngine = `\n  <script>\n${readFileSync(resolve(SKILL, 'shell/main.js'), 'utf8')}\n  </script>\n`; } catch {}

writeFileSync(resolve(OUT, 'lesson.html'),
  `${head}\n<body>\n${body}\n  ${scripts}\n${shellEngine}\n<script>${FSI_JS}</script>\n`);

/* ── assets (siblings only — a .chiron bundle never reaches up-tree) ────────── */
const td = resolve(OUT, 'themes'); mkdirSync(td, { recursive: true });
const ts = resolve(SKILL, 'shell/themes');
if (existsSync(ts)) for (const f of readdirSync(ts)) if (f.endsWith('.css')) copyFileSync(resolve(ts, f), resolve(td, f));
const cw = resolve(SKILL, 'shell/clinical-widgets.css');
if (existsSync(cw)) copyFileSync(cw, resolve(OUT, 'clinical-widgets.css'));

const html = readFileSync(resolve(OUT, 'lesson.html'), 'utf8');
console.log(`assemble-fsi: ${steps.length} sections → ${resolve(OUT, 'lesson.html')}`);
console.log(`  dialogues: ${(html.match(/id="dlg-/g) || []).length}   voiced: ${(html.match(/turn persona-a/g) || []).length}` +
            `   learner: ${(html.match(/data-learner="true"/g) || []).length}   judgeable: ${(html.match(/data-expected=/g) || []).length}`);
