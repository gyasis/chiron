#!/usr/bin/env node
/**
 * Stage 5 Assemble — Blood Chemistry AMBOSS lesson (6 chapters, 53 widgets).
 *
 * Adapted from build-sarcoma-assemble.mjs. Key differences:
 *  - Lesson dir: ~/Documents/generated/chiron-pericardial-diseases-amboss/
 *  - 6 chapters (vs 5 for sarcoma)
 *  - Prose field is `narrativeHtml` OR `exposition` (ch1 uses exposition)
 *  - Additional widget types vs sarcoma: step-cards, glossary-tooltips,
 *    layer-toggle, matching-pair, mathjax, true-false, group-chat-animation, boss
 *  - MathJax CDN script injected for Ch4 LaTeX formulas
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { renderWidget } from '../dist/lib/widget-renderer.js';
import { emitSrDeck, emitSrCardCss } from '../dist/lib/widgets/sr-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');
const OUT_DIR = resolve(process.env.HOME, 'Documents', 'generated', 'chiron-pericardial-diseases-amboss');
const OUT = resolve(OUT_DIR, 'lesson.html');
const DB_PATH = resolve(OUT_DIR, '.chiron-state.db');

// ── helpers ──────────────────────────────────────────────────────────────────

function loadChapter(n) {
  const path = resolve(OUT_DIR, `chapter${n}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Normalise an MCQ option from the chapter JSON format
 * {label: "A", text: "...", correct, explanation} to the shape
 * renderMcqClinicalVignette / renderMcq expect: {label: "...", correct, explanation}.
 */
function normaliseOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(opt => ({
    label: opt.text ?? opt.label ?? '',
    correct: !!opt.correct,
    explanation: opt.explanation ?? '',
  }));
}

/**
 * Render a widget spec from the chapter JSON.
 * Returns the HTML string or a fallback <div> on error.
 */
function renderWidgetSafe(spec, chapterIdx) {
  try {
    // Normalise MCQ-family option shapes
    if (spec.type === 'mcq-clinical-vignette' || spec.type === 'mcq') {
      spec = { ...spec, options: normaliseOptions(spec.options) };
    }
    if (spec.type === 'confidence-weighted' && spec.mcq) {
      spec = {
        ...spec,
        mcq: { ...spec.mcq, options: normaliseOptions(spec.mcq.options) }
      };
    }
    return renderWidget(spec);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[assemble] WARN ch${chapterIdx} widget ${spec.type} (${spec.id ?? '?'}): ${errMsg}\n`);
    return `<div class="widget-render-error" data-widget-type="${spec.type ?? 'unknown'}" data-error="${errMsg.replace(/"/g, '&quot;')}">
  <strong>Widget unavailable:</strong> <code>${spec.type ?? 'unknown'}</code>
  <p class="err-detail">${errMsg}</p>
</div>`;
  }
}

// ── load chapter data ─────────────────────────────────────────────────────────

const chapters = [];
for (let i = 1; i <= 9; i++) {
  chapters.push(loadChapter(i));
}
chapters.sort((a, b) => (a.chapterIndex ?? a.chapterNumber ?? 0) - (b.chapterIndex ?? b.chapterNumber ?? 0));

const brief = JSON.parse(readFileSync(resolve(OUT_DIR, 'brief.json'), 'utf8'));
const syllabus = JSON.parse(readFileSync(resolve(OUT_DIR, 'syllabus.json'), 'utf8'));

// ── widget counters ───────────────────────────────────────────────────────────
const renderedByType = {};
const failedByType = {};

// ── SR cards (all chapters → idioms[]) ───────────────────────────────────────
const allSrIdioms = chapters.flatMap(ch => {
  const cards = ch.srCards ?? ch.sr_cards ?? [];
  return cards.map(c => ({
    it: c.front ?? '',
    meaning: c.back ?? '',
    literal: Array.isArray(c.tags) && c.tags.length > 0 ? c.tags.join(', ') : undefined,
  }));
});

const srDeckHtml = emitSrDeck({ verbs: [], nouns: [], idioms: allSrIdioms });
const srCardCss = emitSrCardCss();

// ── load shell assets ─────────────────────────────────────────────────────────
const shellStylesCss = readFileSync(resolve(SKILL_DIR, 'shell', 'styles.css'), 'utf8');
const clinicalWidgetsCss = readFileSync(resolve(SKILL_DIR, 'shell', 'clinical-widgets.css'), 'utf8');
const shellMainJs = readFileSync(resolve(SKILL_DIR, 'shell', 'main.js'), 'utf8');

// ── markdown mini-renderer ────────────────────────────────────────────────────
function renderInlineMarkdown(html) {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// ── render chapters ───────────────────────────────────────────────────────────
function renderChapter(ch, idx) {
  const chNum = ch.chapterIndex ?? ch.chapterNumber ?? idx + 1;
  const chId = ch.chapterId ?? `ch-${chNum}`;
  const title = ch.title ?? `Chapter ${chNum}`;
  // Handle both prose field names: narrativeHtml (ch2-6) and exposition (ch1)
  const prose = ch.narrativeHtml ?? ch.exposition ?? '';

  const widgetHtmlParts = (ch.widgets ?? []).map(spec => {
    const rawHtml = renderWidgetSafe(spec, chNum);
    const html = renderInlineMarkdown(rawHtml);
    const type = spec.type ?? 'unknown';
    if (html.includes('widget-render-error')) {
      failedByType[type] = (failedByType[type] ?? 0) + 1;
    } else {
      renderedByType[type] = (renderedByType[type] ?? 0) + 1;
    }
    return `\n<div class="widget-slot" data-widget-type="${type}">${html}</div>`;
  });

  return `
<section class="chapter" id="${chId}">
  <div class="ch-num">Chapter ${chNum}</div>
  <h1>${title}</h1>
  <div class="chapter-prose">${prose}</div>
  ${widgetHtmlParts.join('\n')}
</section>`;
}

const chaptersHtml = chapters.map((ch, i) => renderChapter(ch, i)).join('\n');

// ── sidebar TOC ───────────────────────────────────────────────────────────────
const tocLinks = chapters.map(ch => {
  const chNum = ch.chapterIndex ?? ch.chapterNumber ?? '?';
  const chId = ch.chapterId ?? `ch-${chNum}`;
  const title = ch.title ?? `Chapter ${chNum}`;
  return `<a class="toc-link" href="#${chId}" data-chapter-target="${chId}">
    <span class="toc-num">${chNum}.</span>
    <span class="toc-title">${title}</span>
  </a>`;
}).join('\n');

// ── lesson metadata ───────────────────────────────────────────────────────────
const lessonTitle = brief.metadata?.topic ?? brief.topic ?? 'Pericardial Diseases';
const lessonDate = new Date().toISOString().slice(0, 10);
const lessonId = 'chiron-pericardial-diseases-amboss';

// ── component CSS (tokens only — NO hex) ─────────────────────────────────────
const componentCss = `
/* ── Shell reset ──────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100vh;
  background: var(--chiron-bg);
  color: var(--chiron-fg);
  font-family: var(--chiron-font-body);
  font-size: 16px;
  line-height: 1.65;
}

/* ── Sidebar ───────────────────────────────────────────────── */
aside.side {
  background: var(--chiron-surface);
  border-right: 1px solid var(--chiron-border);
  padding: var(--chiron-space-6) var(--chiron-space-5);
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
.side .brand {
  font-family: var(--chiron-font-heading);
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--chiron-accent);
  margin-bottom: var(--chiron-space-2);
}
.side .brand .dot { color: var(--chiron-warm-accent); }
.side .sub {
  font-size: 0.78rem;
  color: var(--chiron-muted);
  margin-bottom: var(--chiron-space-6);
  line-height: 1.4;
}
.side .toc-header {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  margin: var(--chiron-space-6) 0 var(--chiron-space-3);
}
.side .toc-link {
  display: flex;
  gap: var(--chiron-space-2);
  padding: var(--chiron-space-2) var(--chiron-space-3);
  border-radius: var(--chiron-radius-sm);
  color: var(--chiron-fg-secondary);
  text-decoration: none;
  font-size: 0.82rem;
  line-height: 1.3;
  margin-bottom: 2px;
}
.side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
.side .toc-link.active {
  background: var(--chiron-elevated);
  color: var(--chiron-accent);
  border-left: 3px solid var(--chiron-accent);
  padding-left: calc(var(--chiron-space-3) - 3px);
}
.side .toc-num {
  font-family: var(--chiron-font-mono, monospace);
  color: var(--chiron-muted);
  flex-shrink: 0;
  font-size: 0.8rem;
}
.side .toc-title { line-height: 1.3; }

/* ── Theme switcher ────────────────────────────────────────── */
.theme-switcher {
  margin-top: var(--chiron-space-6);
  padding-top: var(--chiron-space-4);
  border-top: 1px solid var(--chiron-divider);
}
.theme-switcher label {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  display: block;
  margin-bottom: var(--chiron-space-2);
}
.theme-switcher select {
  width: 100%;
  font: inherit;
  font-size: 0.8rem;
  background: var(--chiron-surface);
  border: 1px solid var(--chiron-border);
  border-radius: var(--chiron-radius-sm);
  padding: 4px 8px;
  color: var(--chiron-fg);
}

/* ── Main ──────────────────────────────────────────────────── */
main.main { overflow-y: auto; height: 100vh; }

/* ── Chapter ───────────────────────────────────────────────── */
section.chapter {
  max-width: 900px;
  margin: 0 auto;
  padding: 3rem 3rem 5rem;
  border-bottom: 1px solid var(--chiron-divider);
}
section.chapter:last-child { border-bottom: none; }
.ch-num {
  font-family: var(--chiron-font-mono, monospace);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  font-size: 0.75rem;
  margin-bottom: var(--chiron-space-2);
}
section.chapter h1 {
  font-family: var(--chiron-font-heading);
  font-size: 2rem;
  line-height: 1.2;
  margin: 0 0 var(--chiron-space-6);
  color: var(--chiron-fg);
}
.chapter-prose { margin-bottom: var(--chiron-space-6); }
.chapter-prose h2 {
  font-family: var(--chiron-font-heading);
  font-size: 1.25rem;
  margin: var(--chiron-space-6) 0 var(--chiron-space-3);
  color: var(--chiron-fg);
}
.chapter-prose p {
  max-width: 72ch;
  margin: var(--chiron-space-4) 0;
  color: var(--chiron-fg);
}
.chapter-prose ul, .chapter-prose ol {
  max-width: 72ch;
  padding-left: var(--chiron-space-6);
}
.chapter-prose li { margin: var(--chiron-space-2) 0; }
.chapter-prose table {
  border-collapse: collapse;
  font-size: 0.9rem;
  width: 100%;
  margin: var(--chiron-space-4) 0;
}
.chapter-prose th, .chapter-prose td {
  border: 1px solid var(--chiron-border);
  padding: var(--chiron-space-2) var(--chiron-space-3);
  text-align: left;
}
.chapter-prose thead th {
  background: var(--chiron-surface);
  font-weight: 600;
}

/* ── Widget slot ───────────────────────────────────────────── */
.widget-slot { margin: var(--chiron-space-8) 0; }
.widget-render-error {
  background: var(--chiron-surface);
  border: 2px dashed var(--chiron-error);
  border-radius: var(--chiron-radius-sm);
  padding: var(--chiron-space-4);
  font-size: 0.85rem;
  color: var(--chiron-error);
}
.widget-render-error .err-detail {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.78rem;
  color: var(--chiron-muted);
  margin: var(--chiron-space-2) 0 0;
}

/* ── MathJax widget container ──────────────────────────────── */
.mathjax {
  padding: var(--chiron-space-5) var(--chiron-space-6);
  background: var(--chiron-surface);
  border-left: 3px solid var(--chiron-accent);
  border-radius: var(--chiron-radius-sm);
  overflow-x: auto;
  font-size: 1.05rem;
}

/* ── Footer ────────────────────────────────────────────────── */
footer.lesson-footer {
  padding: var(--chiron-space-5) 3rem;
  color: var(--chiron-muted);
  font-size: 0.78rem;
  border-top: 1px solid var(--chiron-divider);
  max-width: 900px;
  margin: 0 auto;
}

/* ── Mobile ────────────────────────────────────────────────── */
@media (max-width: 880px) {
  body { grid-template-columns: 1fr; }
  aside.side { position: relative; height: auto; border-right: none; border-bottom: 1px solid var(--chiron-border); }
  section.chapter { padding: 2rem 1.25rem 4rem; }
}
`;

// ── theme switcher script ─────────────────────────────────────────────────────
const themeSwitcherScript = `
<script>
(function(){
  var themes = ['clinical','midnight','warm-paper','linguistic','ocean'];
  var stored = (new URLSearchParams(window.location.search)).get('theme') ||
               localStorage.getItem('chiron-theme') || 'clinical';
  if (themes.includes(stored)) {
    document.documentElement.setAttribute('data-theme', stored);
  }
  document.addEventListener('DOMContentLoaded', function(){
    var sel = document.querySelector('.theme-select');
    if (!sel) return;
    sel.value = document.documentElement.getAttribute('data-theme') || 'clinical';
    sel.addEventListener('change', function(){
      var t = sel.value;
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('chiron-theme', t);
    });
  });
})();
</script>
`;

// ── MathJax config + loader (for Ch4 LaTeX) ──────────────────────────────────
const mathjaxScript = `
<!-- MathJax 3 — required for Ch4 acid-base LaTeX formulas -->
<script>
MathJax = {
  tex: {
    inlineMath: [['\\\\(', '\\\\)']],
    displayMath: [['\\\\[', '\\\\]'], ['$$', '$$']],
    tags: 'none',
    packages: {'[+]': ['mhchem']}
  },
  options: {
    skipHtmlTags: ['script','noscript','style','textarea','pre']
  },
  startup: {
    pageReady() {
      return MathJax.startup.defaultPageReady();
    }
  }
};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
`;

// ── chat / flow animation JS engine ──────────────────────────────────────────
const animationJs = `
<script>
// Chiron shell engine — group-chat + flow-animation + layer-toggle
(function(){
  'use strict';

  // ── Group Chat Animation engine ─────────────────────────────
  document.querySelectorAll('.chat-window').forEach(function(win){
    var msgs = win.querySelectorAll('.chat-message');
    var progress = win.querySelector('.chat-progress');
    var nextBtn = win.querySelector('.chat-next-btn');
    var allBtn = win.querySelector('.chat-all-btn');
    var resetBtn = win.querySelector('.chat-reset-btn');
    var typing = win.querySelector('.chat-typing');
    var cur = 0;
    function updateProgress(){ if(progress) progress.textContent = cur + ' / ' + msgs.length + ' messages'; }
    function showNext(){
      if(cur >= msgs.length) return;
      if(typing) typing.style.display='none';
      msgs[cur].style.display='flex';
      cur++;
      updateProgress();
      if(cur < msgs.length && typing) {
        typing.style.display='flex';
        setTimeout(function(){ typing.style.display='none'; }, 800);
      }
    }
    function showAll(){
      msgs.forEach(function(m){ m.style.display='flex'; });
      cur = msgs.length;
      if(typing) typing.style.display='none';
      updateProgress();
    }
    function reset(){
      msgs.forEach(function(m){ m.style.display='none'; });
      if(typing) typing.style.display='none';
      cur = 0;
      updateProgress();
    }
    if(nextBtn) nextBtn.addEventListener('click', showNext);
    if(allBtn) allBtn.addEventListener('click', showAll);
    if(resetBtn) resetBtn.addEventListener('click', reset);
    updateProgress();
  });

  // ── Flow Animation engine ───────────────────────────────────
  document.querySelectorAll('.flow-animation').forEach(function(flow){
    var raw = flow.getAttribute('data-steps') || '[]';
    var steps;
    try { steps = JSON.parse(raw.replace(/&quot;/g,'"')); } catch(e){ steps=[]; }
    var label = flow.querySelector('.flow-step-label');
    var progress = flow.querySelector('.flow-progress');
    var nextBtn = flow.querySelector('.flow-next-btn');
    var resetBtn = flow.querySelector('.flow-reset-btn');
    var cur = 0;
    function updateProgress(){ if(progress) progress.textContent = 'Step ' + cur + ' / ' + steps.length; }
    function showStep(n){
      if(n < 1 || n > steps.length) return;
      var s = steps[n-1];
      if(label) label.textContent = (n) + '. ' + s.label;
      flow.querySelectorAll('.flow-actor').forEach(function(a){
        a.classList.toggle('highlight', !!(s.highlight && a.id === 'flow-'+s.highlight));
      });
      cur = n;
      updateProgress();
    }
    if(nextBtn) nextBtn.addEventListener('click', function(){ if(cur < steps.length) showStep(cur+1); });
    if(resetBtn) resetBtn.addEventListener('click', function(){ flow.querySelectorAll('.flow-actor').forEach(function(a){a.classList.remove('highlight');}); cur=0; if(label)label.textContent='Press Next to start.'; updateProgress(); });
    updateProgress();
  });

  // ── Layer Toggle engine ─────────────────────────────────────
  document.querySelectorAll('.layer-toggle').forEach(function(lt){
    lt.querySelectorAll('.lt-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        lt.setAttribute('data-axis-show', btn.getAttribute('data-show'));
        lt.querySelectorAll('.lt-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
      });
    });
  });

  // ── Sidebar TOC scrollspy ───────────────────────────────────
  var tocLinks = document.querySelectorAll('.toc-link');
  tocLinks.forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var target = document.querySelector(a.getAttribute('href'));
      if(target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  var chapters = Array.from(document.querySelectorAll('section.chapter'));
  if(typeof IntersectionObserver !== 'undefined' && chapters.length > 0){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){
          var id = e.target.id;
          tocLinks.forEach(function(a){
            a.classList.toggle('active', a.getAttribute('data-chapter-target') === id);
          });
        }
      });
    }, { rootMargin: '-20% 0px -55% 0px' });
    chapters.forEach(function(c){ io.observe(c); });
  }

  // ── SR card flip ────────────────────────────────────────────
  document.querySelectorAll('.sr-card').forEach(function(card){
    card.addEventListener('click', function(){ card.classList.toggle('flipped'); });
  });
})();
</script>
`;

// ── assemble full HTML ────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en" data-theme="clinical">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="chiron-lesson-id" content="${lessonId}" />
  <title>Chiron · ${lessonTitle}</title>

  <!-- 6 theme <link> tags — theme contract requirement -->
  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />

  <!-- theme switcher must run before body render -->
  ${themeSwitcherScript}

  <!-- MathJax 3 — Ch4 LaTeX acid-base formulas -->
  ${mathjaxScript}

  <style>
/* ── chiron token patch (guarantees full spacing scale inline) ── */
:root {
  --chiron-space-5: 1.25rem;
  --chiron-space-7: 1.75rem;
  --chiron-space-9: 2.25rem;
  --chiron-space-10: 2.5rem;
}

/* ── shell/styles.css (full design system) ──────────────────── */
${shellStylesCss}

/* ── shell structural CSS (layout, sidebar, chapter, footer) ── */
${componentCss}

/* ── canonical medicine widget design language ──────────────── */
${clinicalWidgetsCss}

/* ── SR card CSS ─────────────────────────────────────────────── */
${srCardCss}
  </style>
</head>
<body>
  <aside class="side">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">${lessonTitle}<br>Medicine · AMBOSS · Mode A</div>

    <div class="toc-header">Chapters</div>
    ${tocLinks}

    <div class="theme-switcher">
      <label for="theme-select">Theme</label>
      <select id="theme-select" class="theme-select">
        <option value="clinical">Clinical</option>
        <option value="midnight">Midnight</option>
        <option value="warm-paper">Warm Paper</option>
        <option value="linguistic">Linguistic</option>
        <option value="ocean">Ocean</option>
      </select>
    </div>
  </aside>

  <main class="main">
${chaptersHtml}

    <!-- SR Flashcard Deck — all ${allSrIdioms.length} cards from all chapters -->
    <section class="sr-deck-section" id="sr-deck">
      <h2>SR Flashcard Deck</h2>
      <p class="sr-deck-help">Click any card to flip. Front = concept. Back = key fact + source tags. All ${allSrIdioms.length} cards from all 9 chapters.</p>
      <div class="sr-deck-grid">
        ${srDeckHtml}
      </div>
    </section>

    <footer class="lesson-footer">
      Chiron · ${lessonTitle} · Medicine domain · AMBOSS · Mode A · ${lessonDate}<br>
      Grounded in Harrison's 22e + Gemini grounded research. Generated by chiron Stage 5 Assemble.
    </footer>
  </main>

  <script>
${shellMainJs}
  </script>
  ${animationJs}
</body>
</html>`;

writeFileSync(OUT, html, 'utf8');
process.stderr.write(`[assemble] Wrote: ${OUT}\n`);
process.stderr.write(`[assemble] File size: ${Math.round(html.length / 1024)} KB\n`);

// ── init SQLite DB ────────────────────────────────────────────────────────────
process.stderr.write('[assemble] Initializing .chiron-state.db\n');

const db = new Database(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS _chiron_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chapter_completion (
  course_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (course_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  widget_id TEXT,
  widget_type TEXT,
  attempt_data TEXT,
  correct INTEGER,
  score_delta REAL,
  attempted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mastery (
  course_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  mastery_score REAL NOT NULL DEFAULT 0.0,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (course_id, concept_id)
);
CREATE TABLE IF NOT EXISTS sr_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  concept_id TEXT,
  card_type TEXT NOT NULL DEFAULT 'term-def',
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  next_due_at INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sr_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  old_interval INTEGER,
  new_interval INTEGER,
  old_ease REAL,
  new_ease REAL
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  scroll_position INTEGER NOT NULL DEFAULT 0,
  last_visited_at INTEGER NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS weakness_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  logged_at INTEGER NOT NULL,
  reason TEXT
);
`);

const now = Date.now();
const courseId = lessonId;

db.prepare(`INSERT OR REPLACE INTO _chiron_meta (key, value, updated_at) VALUES (?, ?, ?)`).run('schema_version', '1', now);
db.prepare(`INSERT OR REPLACE INTO _chiron_meta (key, value, updated_at) VALUES (?, ?, ?)`).run('lesson_id', lessonId, now);
db.prepare(`INSERT OR REPLACE INTO _chiron_meta (key, value, updated_at) VALUES (?, ?, ?)`).run('created_at', String(now), now);

const insertCard = db.prepare(`
  INSERT INTO sr_cards (course_id, chapter_id, concept_id, card_type, front, back, tags,
    ease_factor, interval_days, repetitions, next_due_at, suspended)
  VALUES (?, ?, ?, ?, ?, ?, ?, 2.5, 0, 0, ?, 0)
`);
const seedCards = db.transaction(() => {
  chapters.forEach(ch => {
    const chId = String(ch.chapterIndex ?? ch.chapterNumber ?? '1');
    const cards = ch.srCards ?? ch.sr_cards ?? [];
    cards.forEach(c => {
      insertCard.run(courseId, chId, null, 'term-def', c.front, c.back,
        Array.isArray(c.tags) && c.tags.length > 0 ? JSON.stringify(c.tags) : null, now);
    });
  });
});
seedCards();
const cardCount = db.prepare('SELECT COUNT(*) AS n FROM sr_cards').get().n;

const firstChId = String(chapters[0]?.chapterIndex ?? chapters[0]?.chapterNumber ?? '1');
db.prepare(`INSERT OR REPLACE INTO bookmarks (course_id, chapter_id, scroll_position, last_visited_at, note) VALUES (?, ?, 0, ?, NULL)`)
  .run(courseId, firstChId, now);

db.close();
process.stderr.write(`[assemble] DB seeded: ${cardCount} SR cards, 1 bookmark\n`);

// ── report ────────────────────────────────────────────────────────────────────
const totalRendered = Object.values(renderedByType).reduce((a, b) => a + b, 0);
const totalFailed = Object.values(failedByType).reduce((a, b) => a + b, 0);

process.stderr.write('\n[assemble] ── WIDGET RENDER REPORT ─────────────────────────────────\n');
process.stderr.write('[assemble] Rendered by type:\n');
for (const [t, c] of Object.entries(renderedByType).sort(([a],[b])=>a.localeCompare(b))) {
  process.stderr.write(`[assemble]   ${t}: ${c}\n`);
}
if (Object.keys(failedByType).length > 0) {
  process.stderr.write('[assemble] FAILED by type:\n');
  for (const [t, c] of Object.entries(failedByType)) {
    process.stderr.write(`[assemble]   ${t}: ${c}\n`);
  }
}
process.stderr.write(`[assemble] Total rendered: ${totalRendered} / 53 widgets (${totalFailed} failed)\n`);
process.stderr.write(`[assemble] SR cards in deck: ${allSrIdioms.length}\n`);
process.stderr.write(`[assemble] DB: ${DB_PATH}\n`);
process.stderr.write('[assemble] ──────────────────────────────────────────────────────────\n');
