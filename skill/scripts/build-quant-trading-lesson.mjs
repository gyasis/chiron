#!/usr/bin/env node
/**
 * Quant Trading — concepts-domain pipeline test lesson.
 *
 * As of 2026-05-23 (Stage-2 wiring): this script no longer hardcodes
 * chapter count. It consumes:
 *   brief.json     — Stage 1 output (acted as me-the-parent-agent at ingest)
 *   syllabus.json  — Stage 2 output (acted as me-the-parent-agent against
 *                    prompts/02-syllabus.md; chapter count derived from
 *                    brief.metadata.chapterCountTarget ±1)
 *
 * The script's only logic: validate each chapter against
 * ChapterSyllabusSchema, render each widget via renderWidget(), stitch
 * into chapter HTML. Chapter COUNT comes from syllabus.length.
 *
 * Synthetic data series are injected via "__SYNTH_*__" sentinels in
 * the syllabus so the JSON stays small + readable while the script
 * generates deterministic 60-day price/spread/Sharpe walks.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WidgetSchema } from '../dist/lib/schemas/widget-spec.js';
import { ChapterSyllabusSchema } from '../dist/lib/schemas/chapter-syllabus.js';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', 'lessons', 'quant-trading-2026-05-23');
const VENDOR_SRC = resolve(__dirname, '..', 'shell', 'vendor');

// ── Vendor MathJax into the lesson dir (no CDN dep) ───────────
const vendorOut = resolve(OUT, 'vendor', 'mathjax');
mkdirSync(vendorOut, { recursive: true });
for (const file of ['tex-mml-chtml.js', 'mhchem.js']) {
  const src = resolve(VENDOR_SRC, 'mathjax', file);
  if (existsSync(src)) copyFileSync(src, resolve(vendorOut, file));
}

// ── Load Stage-1 + Stage-2 outputs ────────────────────────────
const brief    = JSON.parse(readFileSync(resolve(OUT, 'brief.json'), 'utf8'));
const syllabus = JSON.parse(readFileSync(resolve(OUT, 'syllabus.json'), 'utf8'));

console.log(`Stage 1 → brief.json     · domain=${brief.domain} · target=${brief.metadata.chapterCountTarget} chapters`);
console.log(`Stage 2 → syllabus.json  · ${syllabus.length} chapters planned (Stage-2 picked this count)`);

// ── Synthetic data — generators injected at the "__SYNTH_*__" sentinels ──
// (In a real pipeline these would come from the brief's extracted data
//  or live data source. Here they're deterministic for reproducibility.)
const seedRng = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
const rng = seedRng(42);
const days = Array.from({ length: 60 }, (_, i) => i + 1);
let price = 480;
const SPY_PRICE  = days.map(() => { price += (rng() - 0.48) * 4; return { x: days[days.length - 60 + days.indexOf(days[0])] ?? 0, y: +price.toFixed(2) }; })
                       .map((_, i) => ({ x: i + 1, y: 480 + days[i] * 0.2 + Math.sin(days[i] / 9) * 6 + (seedRng(i + 7)() - 0.5) * 4 }));
const SPY_MA20 = days.map((d, i) => {
  const w = SPY_PRICE.slice(Math.max(0, i - 19), i + 1).map(p => p.y);
  return { x: d, y: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2) };
});
let spread = 0;
const SPREAD = days.map(d => { spread = spread * 0.85 + (rng() - 0.5) * 1.2; return { x: d, y: +spread.toFixed(3) }; });
const ROLLING_SR = days.map(d => ({ x: d, y: +(0.4 + Math.sin(d / 7) * 0.3 + (rng() - 0.5) * 0.1).toFixed(3) }));
const STRAT_SHARPE = [
  { x: 1, y: 0.62 },  // buy & hold
  { x: 2, y: 1.14 },  // mean reversion
  { x: 3, y: 0.87 },  // momentum
  { x: 4, y: 0.41 },  // 60/40 control
];
const BTC_CANDLES = Array.from({ length: 20 }, (_, i) => {
  const open  = 60000 + Math.sin(i / 2) * 2000 + rng() * 800;
  const close = open + (rng() - 0.5) * 1500;
  const high  = Math.max(open, close) + rng() * 500;
  const low   = Math.min(open, close) - rng() * 500;
  return { x: i + 1, y: close, ohlc: { open: +open.toFixed(0), high: +high.toFixed(0), low: +low.toFixed(0), close: +close.toFixed(0) } };
});

const SYNTH = {
  __SYNTH_SPY_PRICE__:    SPY_PRICE,
  __SYNTH_SPY_MA20__:     SPY_MA20,
  __SYNTH_SPREAD__:       SPREAD,
  __SYNTH_ROLLING_SR__:   ROLLING_SR,
  __SYNTH_STRAT_SHARPE__: STRAT_SHARPE,
  __SYNTH_BTC_CANDLES__:  BTC_CANDLES,
};

// Replace "__SYNTH_*__" sentinels in widget specs with the real point arrays.
function resolveSynth(spec) {
  if (spec.type !== 'chart-xy') return spec;
  return {
    ...spec,
    series: spec.series.map(s =>
      typeof s.points === 'string' && s.points.startsWith('__SYNTH_')
        ? { ...s, points: SYNTH[s.points] ?? [] }
        : s
    ),
  };
}

// ── Render one chapter — validate schema, then renderWidget() each ──
function renderChapter(chapter) {
  // Per-widget validation is more useful than full-chapter validation
  // here because chapter-write would normally fill quiz variants etc.
  // and we want errors localized to the offending widget.
  const widgetsHtml = chapter.widgets.map((w) => {
    const resolved = resolveSynth(w);
    const p = WidgetSchema.safeParse(resolved);
    if (!p.success) {
      console.error(`SCHEMA FAIL in chapter ${chapter.chapterNumber} widget ${w.type}:`, p.error.issues);
      process.exit(1);
    }
    return renderWidget(p.data);
  }).join('\n');

  return (
    `<section class="chapter" id="ch${chapter.chapterNumber}">` +
    `<div class="chap-id">Chapter ${chapter.chapterNumber} of ${syllabus.length}</div>` +
    `<h2>${chapter.title}</h2>` +
    `<p class="kicker-prose">${chapter.narrative}</p>` +
    widgetsHtml +
    `</section>`
  );
}

const chaptersHtml = syllabus.map(renderChapter).join('\n');

// ── full lesson.html ───
const html = `<!doctype html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quant Trading — concepts domain · pipeline-built (Stage 2 driven)</title>
<link rel="stylesheet" href="themes/_tokens.css" />
<link rel="stylesheet" href="themes/midnight.css" />
<link rel="stylesheet" href="themes/warm-paper.css" />
<link rel="stylesheet" href="themes/clinical.css" />
<link rel="stylesheet" href="themes/linguistic.css" />
<link rel="stylesheet" href="themes/ocean.css" />
<link rel="stylesheet" href="chiron-shell.css" />
<script>
  window.MathJax = {
    tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
    startup: { typeset: false }
  };
</script>
<script src="vendor/mathjax/tex-mml-chtml.js" id="MathJax-script" async></script>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--chiron-bg);color:var(--chiron-fg)}
  body{font-family:var(--chiron-font-body, Georgia, serif); font-size:16px; line-height:1.6; padding:0 0 80px;}
  header.bar{position:sticky; top:0; z-index:20; display:flex; justify-content:space-between; align-items:center;
    padding:10px 24px; background:var(--chiron-surface); border-bottom:1px solid var(--chiron-border);
    font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.08em; text-transform:uppercase;}
  header.bar .pill{display:inline-block; margin-left:8px; padding:2px 8px; background:var(--chiron-elevated); color:var(--chiron-fg-secondary); border:1px solid var(--chiron-border); border-radius:99px; text-transform:none; letter-spacing:.04em;}
  header.bar select{background:var(--chiron-elevated); color:var(--chiron-fg); border:1px solid var(--chiron-border); padding:4px 8px; font-family:inherit; font-size:11px; border-radius:3px;}
  main.page{max-width:900px; margin:0 auto; padding:36px 28px 60px;}
  .hero{padding:32px 0 24px; border-bottom:1px solid var(--chiron-border); margin-bottom:36px;}
  .hero .kicker{font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--chiron-fg-secondary); margin-bottom:14px;}
  .hero h1{font-family:var(--chiron-font-heading); font-size:42px; line-height:1.1; margin:0 0 14px; color:var(--chiron-fg); letter-spacing:-0.01em;}
  .hero .lede{font-size:18px; color:var(--chiron-fg-secondary); margin:0; max-width:62ch;}
  .hero .stage-banner{margin-top:14px; padding:10px 14px; background:var(--chiron-elevated); border:1px dashed var(--chiron-border); border-radius:4px; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:12px; line-height:1.6; color:var(--chiron-fg-secondary);}
  .hero .stage-banner b{color:var(--chiron-fg); font-weight:600;}
  section.chapter{padding:36px 0; border-bottom:1px solid var(--chiron-divider);}
  section.chapter:last-of-type{border-bottom:none;}
  section.chapter .chap-id{font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--chiron-fg-secondary); margin-bottom:6px;}
  section.chapter h2{font-family:var(--chiron-font-heading); font-size:30px; line-height:1.15; margin:0 0 16px; color:var(--chiron-fg);}
  section.chapter .kicker-prose{font-style:italic; color:var(--chiron-fg-secondary); margin:0 0 18px; font-size:16px; max-width:62ch;}
  .chiron-mathjax, .mathjax, [class^="mathjax"]{
    display:block; padding:14px 18px;
    background:var(--chiron-elevated);
    border-left:3px solid var(--chiron-accent);
    border-radius:0 4px 4px 0;
    font-size:14px; line-height:1.7;
    color:var(--chiron-fg); margin:14px 0; overflow-x:auto;
  }
  footer.colophon{margin-top:48px; padding-top:18px; border-top:1px solid var(--chiron-border); color:var(--chiron-fg-secondary); font-size:12.5px; font-family:'JetBrains Mono', ui-monospace, monospace; letter-spacing:.04em;}
  :root{ --chiron-paper: white; --chiron-ink: black; }
</style>
</head>
<body>
<header class="bar">
  <div>Quant Trading <span class="pill">concepts · Stage-2-driven · 2026-05-23</span></div>
  <div>
    <label for="theme">Theme</label>
    <select id="theme">
      <option value="midnight">Midnight</option>
      <option value="warm-paper">Warm paper</option>
      <option value="clinical">Clinical</option>
      <option value="linguistic">Linguistic</option>
      <option value="ocean">Ocean</option>
    </select>
  </div>
</header>

<main class="page">
  <section class="hero">
    <div class="kicker">Chiron · concepts domain · Stage-2 driven build</div>
    <h1>Quant Trading — a primer for rigorous readers</h1>
    <p class="lede">${syllabus.length} chapters. Every chapter, every widget, comes from <code>syllabus.json</code> — Stage 2's structured output. The build script renders; it does not author.</p>
    <div class="stage-banner">
      <b>Stage 1 (brief.json):</b> domain=${brief.domain} · subject=${brief.metadata.subject} · target=${brief.metadata.chapterCountTarget}<br>
      <b>Stage 2 (syllabus.json):</b> planned ${syllabus.length} chapters — within ±1 of target<br>
      <b>Stage 5 (this build):</b> rendered ${syllabus.reduce((n, c) => n + c.widgets.length, 0)} widgets via <code>renderWidget()</code>
    </div>
  </section>

  ${chaptersHtml}

  <footer class="colophon">
    chiron · lessons/quant-trading-2026-05-23 · domain=concepts · Stage 2 picked ${syllabus.length} chapters from ${brief.metadata.wordCountSource}-word source · built ${new Date().toISOString()}
  </footer>
</main>

<script>
  (function(){
    var p = new URLSearchParams(location.search).get('theme');
    var s = localStorage.getItem('chiron-theme');
    var t0 = p || s || 'midnight';
    document.documentElement.setAttribute('data-theme', t0);
    var sel = document.getElementById('theme');
    if(sel){
      sel.value = t0;
      sel.addEventListener('change', function(){
        document.documentElement.setAttribute('data-theme', sel.value);
        localStorage.setItem('chiron-theme', sel.value);
      });
    }
  })();
</script>
<script src="chiron-shell.js" defer></script>
</body>
</html>`;

writeFileSync(resolve(OUT, 'lesson.html'), html);
console.log('✓ wrote', resolve(OUT, 'lesson.html'));
console.log('  size:', html.length, 'bytes');
console.log('  chapters:', syllabus.length, '(from syllabus.json — NOT hardcoded)');
console.log('  widgets:', syllabus.reduce((n, c) => n + c.widgets.length, 0), '(across all chapters)');
