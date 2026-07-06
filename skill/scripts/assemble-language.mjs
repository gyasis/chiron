#!/usr/bin/env node
// assemble-language.mjs — GENERIC assembler for the language-it WARD/LESSON shape
// (the appunto / diabete / pronto-soccorso shape: cold-open + vocab tables + grammar pearls +
// dialogues + stories + match-madness + sr deck). Shared by BOTH the wards chain and the
// pure-Italian chain. Renders from a typed content.json; reuses the appunto lesson as the shell
// donor (head CSS + trailing scripts) like assemble-passage.mjs reuses fattore-v.
//
//   node assemble-language.mjs <lesson-dir>
//
// Reads:  <dir>/content.json   (authored by the chain — schema below)
// Writes: <dir>/lesson.html    (+ copies themes/ + clinical-widgets.css)
//
// content.json schema:
// { title, subtitle, langName?, cefr?, coldOpen:{it,en},
//   sections:[ { id, title, introHtml?,
//      vocab:[{slug, it, en, note?}],            // → v-table rows, id="vocab-<slug>"
//      pearls:[{slug, it, en}],                  // → grammar-pearl, id="pearl-<slug>", data-en
//      dialogue:{ id, turns:[{who:"a"|"learner", label, text}] },   // persona-a voiced; learner NOT voiced
//      stories:[{id, it, en}] } ],               // story-<id> + storydesc-<id>
//   matchMadness?:{ pairs:[{a,b}] },  srCards?:[{front,back,tags?}] }

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dirname, '..');
const HOME = process.env.HOME;
const REF = resolve(HOME, 'Documents/generated/chiron-italian-appunto/lesson.html');  // shell donor

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node assemble-language.mjs <lesson-dir>'); process.exit(1); }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const c = JSON.parse(readFileSync(resolve(OUT, 'content.json'), 'utf8'));
const dropped = [];
const render = w => { try { return renderWidget(w); } catch (e) { dropped.push({ type: w.type, error: e.message }); return ''; } };

// ── content-block renderers (emit the appunto-shape markup + audio-anchor ids) ──
function vTable(vocab = []) {
  if (!vocab.length) return '';
  const rows = vocab.map(v =>
    `            <tr><td id="vocab-${esc(v.slug)}" class="it">${esc(v.it)}</td><td>${esc(v.en)}</td><td class="ex">${v.note || ''}</td></tr>`
  ).join('\n');
  return `<table class="v-table">\n          <thead><tr><th>Italiano</th><th>English</th><th>Note</th></tr></thead>\n          <tbody>\n${rows}\n          </tbody>\n        </table>`;
}
function pearls(list = []) {
  return list.map(p =>
    `<div class="callout grammar-pearl" id="pearl-${esc(p.slug)}" data-en="${esc(p.en)}"><span class="tag">Perla di grammatica</span> ${p.it || ''}</div>`
  ).join('\n');
}
function dialogue(d) {
  if (!d || !Array.isArray(d.turns)) return '';
  const turns = d.turns.map(t => {
    const learner = t.who === 'learner';
    const cls = learner ? 'turn persona-b' : 'turn persona-a';
    const dl = learner ? ' data-learner="true"' : '';
    // baker extracts the persona-a Italian from `.what > span.it` — match that structure exactly
    return `      <div class="${cls}"${dl}><span class="speaker">${esc(t.label)}</span><div class="what"><span class="it">${esc(t.text)}</span></div></div>`;
  }).join('\n');
  return `<div class="dialogue" id="dlg-${esc(d.id)}">\n${turns}\n      </div>`;
}
function stories(list = []) {
  return list.map(s =>
    `<div class="story-block"><p class="story" id="story-${esc(s.id)}" lang="it">${esc(s.it)}</p>` +
    `<p class="storydesc" id="storydesc-${esc(s.id)}">${esc(s.en)}</p></div>`
  ).join('\n');
}
function section(s) {
  return `    <section class="lesson-section" id="${esc(s.id)}">\n` +
    `      <h2 class="section-h">${esc(s.title)}</h2>\n` +
    (s.introHtml ? `      <div class="sec-intro">${s.introHtml}</div>\n` : '') +
    (s.vocab ? `      ${vTable(s.vocab)}\n` : '') +
    (s.pearls ? `      ${pearls(s.pearls)}\n` : '') +
    (s.dialogue ? `      ${dialogue(s.dialogue)}\n` : '') +
    (s.stories ? `      ${stories(s.stories)}\n` : '') +
    `    </section>`;
}

// match-madness + sr deck via renderWidget (shared widgets)
const mmHtml = c.matchMadness ? render({ type: 'match-madness', id: 'mm', ...c.matchMadness }) : '';
const srHtml = c.srCards ? render({ type: 'language-flashcard-deck', id: 'srdeck', title: 'Flashcards', verbs: [], nouns: [], idioms: [], cards: c.srCards }) : '';

const contentSections = (c.sections || []).map(section).join('\n');
const tocLinks = (c.sections || []).map((s, i) =>
  `      <a class="toc-link" href="#${esc(s.id)}" data-toc-target="${esc(s.id)}"><span class="toc-num">${i}.</span><span class="toc-title">${esc(s.title)}</span></a>`
).join('\n')
  + (c.matchMadness ? `\n      <a class="toc-link" href="#match-madness" data-toc-target="match-madness"><span class="toc-num">✦</span><span class="toc-title">Match Madness</span></a>` : '')
  + `\n      <a class="toc-link" href="#closing" data-toc-target="closing"><span class="toc-num">✦</span><span class="toc-title">Riepilogo</span></a>`;

const body = `
  <aside class="side" aria-label="Table of contents">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">${esc(c.langName || 'Italiano')} · ${esc(c.cefr || 'B1')}<br>${esc(c.title)}</div>
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
      <div class="eyebrow">Chiron · ${esc(c.langName || 'Italiano')} · ${esc(c.cefr || 'B1')} · skeleton v1</div>
      <h1 class="lesson-title">${esc(c.title)}</h1>
      ${c.subtitle ? `<p class="subtitle">${esc(c.subtitle)}</p>` : ''}
    </header>
    ${c.coldOpen ? `<div class="cold-open" data-en="${esc(c.coldOpen.en)}"><span class="it">${esc(c.coldOpen.it)}</span></div>` : ''}
${contentSections}
    ${mmHtml ? `<section class="lesson-section" id="match-madness"><h2 class="section-h">✦ Match Madness</h2>${mmHtml}</section>` : ''}
    <section class="lesson-section" id="closing"><h2 class="section-h">✦ Riepilogo</h2>${srHtml}${c.closingHtml || ''}</section>
    <footer class="lesson-footer">Chiron · ${esc(c.langName || 'Italiano')} · Lucrezia</footer>
  </div></main>`;

// shell donor: appunto head (CSS) + trailing scripts (audio player, scroll-spy, reveal-en, theme switcher)
const ref = readFileSync(REF, 'utf8');
const head = ref.slice(0, ref.indexOf('</head>') + 7).replace(/<title>[\s\S]*?<\/title>/, `<title>Chiron · ${esc(c.title)}</title>`);
const sIdx = ref.indexOf('<!-- ', ref.indexOf('</main>'));
const scripts = sIdx > 0 ? ref.slice(sIdx) : ref.slice(ref.indexOf('</main>') + 7);
let shellEngine = '';
try { shellEngine = `\n  <script>\n${readFileSync(resolve(SKILL, 'shell/main.js'), 'utf8')}\n  </script>\n`; } catch {}

writeFileSync(resolve(OUT, 'lesson.html'), `${head}\n<body>\n${body}\n${shellEngine}\n  ${scripts}`);

// assets
const td = resolve(OUT, 'themes'); mkdirSync(td, { recursive: true });
const ts = resolve(SKILL, 'shell/themes');
if (existsSync(ts)) for (const f of readdirSync(ts)) if (f.endsWith('.css')) copyFileSync(resolve(ts, f), resolve(td, f));
const cw = resolve(SKILL, 'shell/clinical-widgets.css');
if (existsSync(cw)) copyFileSync(cw, resolve(OUT, 'clinical-widgets.css'));

const nv = (c.sections || []).reduce((a, s) => a + (s.vocab?.length || 0), 0);
console.log(`[assemble-language] → lesson.html | sections=${(c.sections || []).length} vocab=${nv} pearls=${(c.sections || []).reduce((a, s) => a + (s.pearls?.length || 0), 0)} dialogues=${(c.sections || []).filter(s => s.dialogue).length} | dropped: ${dropped.map(d => d.type).join(',') || 'none'}`);
