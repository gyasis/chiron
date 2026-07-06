#!/usr/bin/env node
// assemble-passage.mjs — GENERIC assembler for the language-it `passage` sub-mode.
// Drives renderWidget from a lesson dir's breakdown.json (04t output) + source/passage.json,
// reusing the fattore-v shell (head CSS + trailing scripts — content-agnostic) as the donor,
// and regenerating the body (sidebar + the 5 fixed passage sections) generically.
//
//   node assemble-passage.mjs <lesson-dir>
//
// Reads:  <dir>/breakdown.json, <dir>/source/passage.json
// Writes: <dir>/lesson.html   (+ copies themes/ + clinical-widgets.css next to it)
// Sections (fixed for passage shape): overview · breakdown · medicine · question · closing.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dirname, '..');
const HOME = process.env.HOME;
const REF = resolve(HOME, 'Documents/generated/chiron-ssm-fattore-v/lesson.html');  // shell donor

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node assemble-passage.mjs <lesson-dir>'); process.exit(1); }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const passage = JSON.parse(readFileSync(resolve(OUT, 'source/passage.json'), 'utf8'));
const bd = JSON.parse(readFileSync(resolve(OUT, 'breakdown.json'), 'utf8'));

// ── widget selection by type → section ───────────────────────────────────────
const widgets = bd.widgets || [];
const pick = t => widgets.find(w => w.type === t);
const pickAll = ts => widgets.filter(w => ts.includes(w.type));

// ── widget normalizer (field-alias fixes — the medicine-chain pattern; NOT a prompt change) ──
const dropped = [];
function normalizeWidget(w) {
  if (w.type === 'annotated-passage') {
    if (!Array.isArray(w.anomalies)) w.anomalies = Array.isArray(bd.anomalies) ? bd.anomalies : [];  // renderer reads spec.anomalies.length
    if (!w.register) w.register = bd.register || 'formal';
    for (const s of (w.sentences || [])) {
      if (!Array.isArray(s.tokens)) s.tokens = [];
      if (!Array.isArray(s.phrases)) s.phrases = [];
      if (!Array.isArray(s.tips)) s.tips = [];
    }
  }
  if (w.type === 'glossary-tooltips' && !Array.isArray(w.entries) && Array.isArray(w.terms)) {
    w.entries = w.terms.map(t => ({ term: t.term || t.it || t.surface || '', definition: t.definition || t.en || t.gloss || t.meaning || '' }));
  }
  if (w.type === 'pattern-cards' && Array.isArray(w.cards)) {           // renderer wants {title, body, foot?}; 04t emits {front, back}
    w.cards = w.cards.map(c => ({
      num: c.num, title: c.title || c.front || c.heading || c.term || '',
      body: c.body || c.back || c.detail || c.text || c.definition || '',
      foot: c.foot || c.note || undefined,
    }));
  }
  if (w.type === 'flow-animation') {                                    // renderer wants actors[]+steps[].label; 04t emits steps[].{label,detail}
    const raw = Array.isArray(w.steps) ? w.steps : [];
    if (!Array.isArray(w.actors) || !w.actors.length) {
      w.actors = raw.map((s, i) => ({ id: `n${i}`, label: s.label || s.title || `Step ${i + 1}`, icon: s.icon }));
      w.steps = raw.map((s, i) => ({ label: s.detail || s.label || '', ...(i > 0 ? { from: `n${i - 1}` } : {}), to: `n${i}` }));
    }
  }
  if (w.type === 'mcq' && Array.isArray(w.options)) {
    // renderer shows opt.label as the BODY + opt.explanation as reasoning; 04t emits {label:LETTER, text, reasoning}
    let opts = w.options.map(o => ({
      label: o.text || o.label || '',                                   // the REAL option text (not the letter)
      correct: o.correct === true,
      explanation: o.explanation || o.reasoning || '',
    }));
    // RANDOMIZE order so the correct answer isn't in a fixed position (anti-gaming); never reveal it in prose
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    w.options = opts;
    w.correctIndex = opts.findIndex(o => o.correct);
    if (w.correctLabel) delete w.correctLabel;
  }
  if (w.type === 'language-flashcard-deck') {                           // renderer builds REGULAR paradigms; keep only clean regular-class verbs
    const VFAM = new Set(['are', 'ere', 'ire', 'isco-ire']);            // (showing a fake regular paradigm for an irregular verb would be WRONG → drop those)
    w.verbs = (Array.isArray(w.verbs) ? w.verbs : [])
      .filter(v => v && v.infinitive && VFAM.has(v.family) && v.irregular !== true)
      .map(v => ({ ...v, irregular: (v.irregular && typeof v.irregular === 'object') ? v.irregular : undefined }));
    w.nouns = (Array.isArray(w.nouns) ? w.nouns : []).filter(n => n && (n.it || n.bare || n.term));
    w.idioms = Array.isArray(w.idioms) ? w.idioms : [];
  }
  return w;
}
// render: normalize → renderWidget; on failure DROP + LOG (never emit a broken comment into the lesson)
const render = w => {
  try { return renderWidget(normalizeWidget(w)); }
  catch (e) { dropped.push({ type: w.type, error: e.message }); return ''; }
};

const ap = pick('annotated-passage');
const apHtml = ap ? render(ap) : '<p><em>(annotated-passage missing)</em></p>';

// scenario chat — uses the SHARED renderer (renderGroupChatAnimation now emits the 🇬🇧 EN toggle when
// messages carry bodyEn; CSS in clinical-widgets.css, toggle JS in main.js — universal across all lessons).
const scenarioHtml = pickAll(['group-chat-animation']).map(render).join('\n');
const medHtml = pickAll(['why-care-callout', 'pattern-cards', 'flow-animation', 'glossary-tooltips']).map(render).join('\n');
const qHtml = pickAll(['mcq', 'cloze', 'fill-blank']).map(render).join('\n');
const deckHtml = pickAll(['language-flashcard-deck']).map(render).join('\n');

// ── the verbatim exam item (read-first) ──────────────────────────────────────
const optionsList = (passage.options_it || []).map(o => {
  // strip any leading "A." — the <ol type="A"> already renders the letter (avoid double "A. A.")
  const m = o.match(/^[A-E]\.\s*(.*)$/);
  return `        <li>${esc(m ? m[1] : o)}</li>`;
}).join('\n');
const passageFull = `<blockquote class="passage-full" lang="it" id="passage-full">
        <p class="pf-stem">${esc(passage.stem_it)}</p>
        <ol class="pf-options" type="A">
${optionsList}
        </ol>
      </blockquote>`;
const passageListen = `<div class="passage-listen" id="passage-listen">
        <span class="pl-tag">🎧 Lucrezia legge l'intero quesito — ascolta prima</span>
        <span class="pl-sub">Listen to the whole item first (stem + the options) — natural speed, then slow &amp; enunciated.</span>
        <div class="pl-btns">
          <button type="button" class="pl-btn" data-src="audio/section/passage-fast.mp3"><span class="pl-ico">▶</span> Veloce</button>
          <button type="button" class="pl-btn" data-src="audio/section/passage-slow.mp3"><span class="pl-ico">▶</span> Lenta &amp; scandita</button>
        </div>
      </div>`;

const title = bd.title || passage.specialization || 'Quesito SSM';
// the correct option's TEXT (the letter is now randomized at render time, so never reference the letter)
const _correctOpt = (passage.options_it || []).find(o => o.startsWith((passage.correct || '') + '.'));
const correctText = _correctOpt ? _correctOpt.replace(/^[A-E]\.\s*/, '') : (passage.correct || '');
const subtitle = 'A real SSM residency item — read it, hear it, take it apart word by word, and meet the medicine underneath.';
const orient = bd.narrativeHtml || '';
// cold-open greeting (the audio summary is the spoken version; this is the on-page warm open)
const coldOpenIt = `Buongiorno, Gyasi — guarda chi è tornato. Oggi prendiamo un vero quesito SSM e lo apriamo parola per parola. Leggi prima tutto — il caso e le opzioni — poi te lo leggo io.`;
const coldOpenEn = `Good morning, Gyasi — look who's back. Today we take a real SSM item and open it word by word. Read it all first — the case and the options — then I'll read it to you.`;

// ── body (sidebar + 5 sections) ──────────────────────────────────────────────
const body = `
  <aside class="side" aria-label="Table of contents">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">Italiano medico · SSM · livello base<br>${esc(title)}</div>
    <div class="toc-header">Sezioni</div>
    <nav class="toc-nav" aria-label="Lesson sections">
      <a class="toc-link" href="#overview" data-toc-target="overview"><span class="toc-num">0.</span><span class="toc-title">Il quesito</span></a>
      <a class="toc-link" href="#breakdown" data-toc-target="breakdown"><span class="toc-num">1.</span><span class="toc-title">Analisi della frase</span></a>
      <a class="toc-link" href="#medicine" data-toc-target="medicine"><span class="toc-num">2.</span><span class="toc-title">La medicina</span></a>
      <a class="toc-link" href="#question" data-toc-target="question"><span class="toc-num">3.</span><span class="toc-title">La risposta</span></a>
      <a class="toc-link" href="#closing" data-toc-target="closing"><span class="toc-num">✦</span><span class="toc-title">Chiusura</span></a>
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
      <div class="eyebrow">Chiron · Italiano medico · SSM · passage-mode · skeleton v1</div>
      <h1 class="lesson-title">${esc(title)}</h1>
      <p class="subtitle">${esc(subtitle)}</p>
    </header>

    <section class="lesson-section" id="overview">
      <h2 class="section-h"><span class="num">0</span>Il quesito — l'intero item</h2>
      <div class="cold-open" data-en="${esc(coldOpenEn)}"><span class="it">${esc(coldOpenIt)}</span></div>
      ${orient ? `<div style="margin-top:var(--chiron-space-5);color:var(--chiron-fg-secondary);">${orient}</div>` : ''}
      <p style="margin-top: var(--chiron-space-5); color: var(--chiron-fg-secondary);">
        Below is the <strong>complete exam item</strong> — the clinical stem followed by the lettered options, exactly as on the SSM paper. Read it in Italian, then press <strong>▶ Veloce</strong> (natural speed) and <strong>▶ Lenta &amp; scandita</strong> (slow, enunciated). The full 🎧 player lives bottom-right.
      </p>
      ${passageFull}
      ${passageListen}
    </section>

    <section class="lesson-section" id="breakdown">
      <h2 class="section-h"><span class="num">1</span>Analisi della frase — parola per parola</h2>
      <p style="color: var(--chiron-fg-secondary);">
        The stem, dissected. Every word — including the small ones (each preposition, the reflexive <em>si</em>, each piece of a verb phrase) — has a note. Toggle the layers; press any inline ▶ to hear that line.
      </p>
      ${apHtml}
    </section>

    <section class="lesson-section" id="medicine">
      <h2 class="section-h"><span class="num">2</span>La medicina</h2>
      <p style="color: var(--chiron-fg-secondary);">
        The Italian has handed us the clinical picture. Here is why it matters, and how each option relates (or doesn't) to the finding.
      </p>
      ${scenarioHtml ? `<div class="scenario-block"><p style="color:var(--chiron-fg-secondary);">A scene from the ward — watch it play out, then you'll see the answer the way you'd meet it in real life.</p>${scenarioHtml}</div>` : ''}
      ${medHtml || '<p><em>(no domain widgets)</em></p>'}
    </section>

    <section class="lesson-section" id="question">
      <h2 class="section-h"><span class="num">3</span>La risposta — answer the item</h2>
      <p style="color: var(--chiron-fg-secondary);">
        These are the <strong>real options</strong> from the SSM item — shuffled, so don't go by position. Pick one and check; each reveals its per-option reasoning.
      </p>
      <div data-options="real">
        ${qHtml || '<p><em>(no comprehension widgets)</em></p>'}
      </div>
      ${deckHtml}
    </section>

    <section class="lesson-section" id="closing">
      <h2 class="section-h"><span class="num">✦</span>Chiusura</h2>
      <div class="closing">
        <p style="margin-bottom: var(--chiron-space-4);"><em>Lucrezia</em>: «Bravo, Gyasi. Una parola ti ha portato alla risposta. A presto… io sono qui.»</p>
        <p>In this item you worked through the full SSM stem + options (read as text and audio), the beginner grammar of the sentence, and the medicine underneath — landing on <strong>${esc(correctText)}</strong>.</p>
      </div>
    </section>

    <footer class="lesson-footer">
      Chiron · Italiano medico · SSM · passage sub-mode · Lucrezia · ${passage.qid}
    </footer>
  </div><!-- /.lesson-shell -->
  </main><!-- /.main -->`;

// ── shell donor: reuse fattore-v's head (CSS) + trailing scripts (content-agnostic) ──
const ref = readFileSync(REF, 'utf8');
const head = ref.slice(0, ref.indexOf('</head>') + 7)
  .replace(/<title>[\s\S]*?<\/title>/, `<title>Chiron · SSM · ${esc(title)}</title>`);
const scriptsStart = ref.indexOf('<!-- Theme switcher -->');
const scripts = ref.slice(scriptsStart);  // theme switcher + scroll-spy + passage-listen + reveal-en + chiron-listen player + </body></html>

// Chiron shell engine (group-chat Next/Skip/Reset + flow-animation + layer-toggle) — required for the
// scenario chat + flow-animation + annotated-passage toggles to actually animate. NOT in fattore-v's scripts.
let shellEngine = '';
try { shellEngine = `\n  <script>\n${readFileSync(resolve(SKILL, 'shell/main.js'), 'utf8')}\n  </script>\n`; } catch {}

const html = `${head}\n<body>\n${body}\n${shellEngine}\n  ${scripts}`;
writeFileSync(resolve(OUT, 'lesson.html'), html);

// ── copy shell assets (themes + clinical widget CSS) next to the lesson ──
const themesDst = resolve(OUT, 'themes'); mkdirSync(themesDst, { recursive: true });
const themesSrc = resolve(SKILL, 'shell/themes');
if (existsSync(themesSrc)) for (const f of readdirSync(themesSrc)) if (f.endsWith('.css')) copyFileSync(resolve(themesSrc, f), resolve(themesDst, f));
const cwSrc = resolve(SKILL, 'shell/clinical-widgets.css');
if (existsSync(cwSrc)) copyFileSync(cwSrc, resolve(OUT, 'clinical-widgets.css'));

if (dropped.length) {
  mkdirSync(resolve(OUT, '.scratch'), { recursive: true });
  writeFileSync(resolve(OUT, '.scratch/dropped-widgets.json'), JSON.stringify(dropped, null, 2));
}
const apOk = !dropped.some(d => d.type === 'annotated-passage');
console.log(`[assemble-passage] ${passage.qid} → lesson.html (${html.length} bytes) | annotated-passage rendered: ${apOk ? 'YES' : 'NO'}`
  + ` | dropped (${dropped.length}): ${dropped.map(d => d.type).join(', ') || 'none'} | themes+clinical-widgets.css copied`);
