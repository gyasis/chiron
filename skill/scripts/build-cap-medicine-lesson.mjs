#!/usr/bin/env node
/**
 * CAP (Community-Acquired Pneumonia) — medicine domain, Step 2 CK.
 *
 * The first chiron medicine lesson that exercises the full canonical
 * AMBOSS-style chapter structure: specialty + level + clinicalAtlasUnits
 * + per-chapter medicineSections in canonical order.
 *
 * Validates that:
 *   - brief.medicalLevel='step-2-ck' picks up the cf/dx/tx required set
 *   - brief.clinicalAtlasUnits=['cap'] binds the single chapter
 *   - chapter.medicineSections covers all 11 canonical sections
 *   - validateLesson() passes — chapter count, atlas binding, section
 *     presence + order
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WidgetSchema } from '../dist/lib/schemas/widget-spec.js';
import { renderWidget } from '../dist/lib/widget-renderer.js';
import { validateLesson, validateSyllabus } from '../dist/lib/validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', 'lessons', 'medicine-cap-step2ck-2026-05-23');
const VENDOR_SRC = resolve(__dirname, '..', 'shell', 'vendor');

// ── Copy vendored MathJax + chiron-shell into lesson dir ─────
mkdirSync(resolve(OUT, 'vendor', 'mathjax'), { recursive: true });
for (const f of ['tex-mml-chtml.js', 'mhchem.js']) {
  const src = resolve(VENDOR_SRC, 'mathjax', f);
  if (existsSync(src)) copyFileSync(src, resolve(OUT, 'vendor', 'mathjax', f));
}

// ── Load Stage-1 + Stage-2 outputs ────────────────────────
const brief    = JSON.parse(readFileSync(resolve(OUT, 'brief.json'), 'utf8'));
const syllabus = JSON.parse(readFileSync(resolve(OUT, 'syllabus.json'), 'utf8'));

console.log('=== Medicine lesson build ===');
console.log(`  Stage 1 brief.json : domain=${brief.domain} specialty=${brief.medicalSpecialty} level=${brief.medicalLevel} atlas=[${(brief.clinicalAtlasUnits || []).join(',')}]`);
console.log(`  Stage 2 syllabus   : ${syllabus.length} chapter(s)`);

// ── Validate lesson-level (chapter count, atlas binding, section structure) ──
const lesson = validateLesson(brief, syllabus);
console.log(`\n=== validateLesson() — lesson-level invariants ===`);
if (lesson.ok) {
  console.log(`  ✓ All lesson-level invariants pass`);
} else {
  console.log(`  ✗ ${lesson.issues.length} issue(s):`);
  for (const issue of lesson.issues) console.log(`    [${issue.code}] ${issue.path}: ${issue.message}`);
  process.exit(1);
}

// ── Per-chapter validation (existing FR-021/022/023 + engagement floors) ──
const dag = {}; // empty DAG for this minimal lesson; real chiron would supply
for (const ch of syllabus) {
  const v = validateSyllabus(ch, dag);
  if (!v.ok) {
    // Only show "real" issues — dag-missing-concept is expected since we have empty DAG
    const real = v.issues.filter(i => i.code !== 'dag-missing-concept');
    if (real.length > 0) {
      console.log(`\n  ⚠ chapter ${ch.chapterNumber} (${ch.chapterId}):`);
      for (const issue of real) console.log(`    [${issue.code}] ${issue.path}: ${issue.message}`);
    }
  }
}

// ── Render widgets ────────────────────────────────────────
console.log(`\n=== Rendering ===`);
function R(spec) {
  const p = WidgetSchema.safeParse(spec);
  if (!p.success) {
    console.error('SCHEMA FAIL', spec.type, p.error.issues);
    process.exit(1);
  }
  return renderWidget(p.data);
}

const chaptersHtml = syllabus.map((ch) => {
  const sectionsBadge = (ch.medicineSections || []).map(s =>
    `<span class="amboss-section">${s}</span>`
  ).join('');
  const widgetsHtml = ch.widgets.map(R).join('\n');
  return (
    `<section class="chapter" id="ch${ch.chapterNumber}">` +
    `<div class="chap-id">Chapter ${ch.chapterNumber} of ${syllabus.length} · ${ch.clinicalAtlasUnit ?? ''}</div>` +
    `<h2>${ch.title}</h2>` +
    `<p class="kicker-prose">${ch.narrative}</p>` +
    `<div class="amboss-sections-bar"><span class="amboss-label">AMBOSS sections covered:</span> ${sectionsBadge}</div>` +
    widgetsHtml +
    `</section>`
  );
}).join('\n');

console.log(`  ✓ rendered ${syllabus.reduce((n, c) => n + c.widgets.length, 0)} widgets`);

// ── Assemble ──────────────────────────────────────────────
const html = `<!doctype html>
<html lang="en" data-theme="clinical">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CAP (Step 2 CK) — chiron medicine pipeline lesson</title>
<link rel="stylesheet" href="themes/_tokens.css" />
<link rel="stylesheet" href="themes/midnight.css" />
<link rel="stylesheet" href="themes/warm-paper.css" />
<link rel="stylesheet" href="themes/clinical.css" />
<link rel="stylesheet" href="themes/linguistic.css" />
<link rel="stylesheet" href="themes/ocean.css" />
<link rel="stylesheet" href="chiron-shell.css" />
<script>
  window.MathJax = {
    tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] },
    options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'] },
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
  main.page{max-width:920px; margin:0 auto; padding:36px 28px 60px;}
  .hero{padding:32px 0 24px; border-bottom:1px solid var(--chiron-border); margin-bottom:36px;}
  .hero .kicker{font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--chiron-fg-secondary); margin-bottom:14px;}
  .hero h1{font-family:var(--chiron-font-heading); font-size:42px; line-height:1.1; margin:0 0 14px; color:var(--chiron-fg); letter-spacing:-0.01em;}
  .hero .lede{font-size:18px; color:var(--chiron-fg-secondary); margin:0; max-width:62ch;}
  .hero .stage-banner{margin-top:14px; padding:10px 14px; background:var(--chiron-elevated); border:1px dashed var(--chiron-border); border-radius:4px; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:12px; line-height:1.6; color:var(--chiron-fg-secondary);}
  .hero .stage-banner b{color:var(--chiron-fg); font-weight:600;}
  section.chapter{padding:36px 0; border-bottom:1px solid var(--chiron-divider);}
  section.chapter:last-of-type{border-bottom:none;}
  section.chapter .chap-id{font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--chiron-fg-secondary); margin-bottom:6px;}
  section.chapter h2{font-family:var(--chiron-font-heading); font-size:32px; line-height:1.15; margin:0 0 16px; color:var(--chiron-fg);}
  section.chapter .kicker-prose{font-style:italic; color:var(--chiron-fg-secondary); margin:0 0 18px; font-size:16px; max-width:62ch;}
  .amboss-sections-bar{
    display:flex; gap:6px; flex-wrap:wrap; align-items:center;
    margin:0 0 20px; padding:8px 12px;
    background:var(--chiron-surface); border:1px solid var(--chiron-border); border-radius:4px;
    font-family:'JetBrains Mono', ui-monospace, monospace; font-size:10.5px;
  }
  .amboss-sections-bar .amboss-label{ text-transform:uppercase; letter-spacing:.12em; color:var(--chiron-fg-secondary); margin-right:6px;}
  .amboss-section{
    padding:2px 7px; background:var(--chiron-elevated); color:var(--chiron-fg);
    border:1px solid var(--chiron-border); border-radius:99px; font-size:10px;
  }
  .chiron-mathjax, .mathjax, [class^="mathjax"]{
    display:block; padding:14px 18px;
    background:var(--chiron-elevated);
    border-left:3px solid var(--chiron-accent);
    border-radius:0 4px 4px 0;
    font-size:14px; line-height:1.7; color:var(--chiron-fg);
    margin:14px 0; overflow-x:auto;
  }
  footer.colophon{margin-top:48px; padding-top:18px; border-top:1px solid var(--chiron-border); color:var(--chiron-fg-secondary); font-size:12.5px; font-family:'JetBrains Mono', ui-monospace, monospace; letter-spacing:.04em;}
  :root{ --chiron-paper: white; --chiron-ink: black; }
</style>
</head>
<body>
<header class="bar">
  <div>CAP · Step 2 CK <span class="pill">medicine · ${brief.medicalSpecialty} · ${brief.medicalLevel}</span></div>
  <div>
    <label for="theme">Theme</label>
    <select id="theme">
      <option value="clinical" selected>Clinical</option>
      <option value="midnight">Midnight</option>
      <option value="warm-paper">Warm paper</option>
      <option value="linguistic">Linguistic</option>
      <option value="ocean">Ocean</option>
    </select>
  </div>
</header>

<main class="page">
  <section class="hero">
    <div class="kicker">Chiron · medicine · AMBOSS-style canonical layout · 2026-05-23</div>
    <h1>Community-Acquired Pneumonia</h1>
    <p class="lede">Step 2 CK primer. One chapter, ${syllabus[0].medicineSections.length} canonical sections, ${syllabus.reduce((n,c)=>n+c.widgets.length,0)} widgets. Chapter count came from <code>brief.clinicalAtlasUnits</code> — not a hardcoded array.</p>
    <div class="stage-banner">
      <b>Stage 1 brief.json:</b> domain=${brief.domain} · specialty=${brief.medicalSpecialty} · level=${brief.medicalLevel}<br>
      <b>Stage 1 atlas:</b> [${(brief.clinicalAtlasUnits || []).join(', ')}] → ${(brief.clinicalAtlasUnits || []).length} chapter(s)<br>
      <b>Stage 2 syllabus.json:</b> ${syllabus.length} chapter · ${syllabus[0].medicineSections.length} sections in canonical AMBOSS order<br>
      <b>validateLesson():</b> ✓ atlas binding · ✓ section presence · ✓ section order · ✓ Step-2-CK required set (cf/dx/tx) all present
    </div>
  </section>

  ${chaptersHtml}

  <footer class="colophon">
    chiron · lessons/medicine-cap-step2ck-2026-05-23 · domain=medicine · specialty=internal-med · level=step-2-ck · atlas=[community-acquired-pneumonia] · built ${new Date().toISOString()}
  </footer>
</main>

<script>
  (function(){
    var p = new URLSearchParams(location.search).get('theme');
    var s = localStorage.getItem('chiron-theme');
    var t0 = p || s || 'clinical';
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
console.log(`\n✓ wrote ${resolve(OUT, 'lesson.html')}`);
console.log(`  size: ${html.length} bytes`);
console.log(`  chapters: ${syllabus.length} (driven by brief.clinicalAtlasUnits)`);
console.log(`  medicine sections: ${syllabus[0].medicineSections.length} (canonical AMBOSS order)`);
