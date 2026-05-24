#!/usr/bin/env node
/**
 * CONCEPTS-DOMAIN lesson builder (Packt-styled).
 *
 * Concepts-domain content = rigorous-learner material that isn't code,
 * medicine, language, or paper-shaped. Math primers, formal logic, signal
 * processing, statistics, law, finance, music theory, quant trading.
 *
 * This script is the canonical concepts-domain template. The current
 * INSTANCE (chapters array below) is "Quant Trading — A Primer." Future
 * concepts lessons (linear algebra, signal processing, law primer, …)
 * clone this script + swap the `chapters` array and `LESSON_DIR`.
 *
 * Modelled on PacktPub's digital book reader / Packt+ subscription
 * platform — hands-on workshop pedagogy. Every chapter starts with
 * "By the end of this chapter you will…" learning objectives and ends
 * with a "Summary" recap. Packt admonition system (Note / Tip / Warning
 * / Best Practice / Hands-on Exercise). Tree-view sidebar TOC with
 * scroll-spy-highlighted sub-sections.
 *
 * Block vocabulary:
 *   - learning-objectives  (chapter opens with "By the end…")
 *   - technical-requirements (tools, data, prerequisites)
 *   - admonition           (Note / Tip / Warning / Best Practice / Hands-on)
 *   - math-callout         (MathJax \[ \] formula)
 *   - scheme-table         (comparison table)
 *   - svg-flowchart        (real boxes + arrows, NOT ASCII)
 *   - svg-line-chart       (time-series / spread)
 *   - comparison-cards     (side-by-side worked-example cards)
 *   - code-block           (dark IDE, monokai-ish)
 *   - chapter-summary      (closing recap)
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const LESSON_DIR = resolve(REPO, 'lessons/bill-becomes-law-2026-05-23');
const LESSON_TITLE = 'How a Bill Becomes a Law — The Full Life Story';

// ─────────────────────────────────────────────────────────────
// Deterministic data series for inline SVG charts
// ─────────────────────────────────────────────────────────────
function seedRng(s) { return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
const r1 = seedRng(42), r2 = seedRng(7);
const days = Array.from({ length: 60 }, (_, i) => i + 1);
const spyPrice = days.map((d, i) => 480 + i * 0.25 + Math.sin(i / 9) * 6 + (r1() - 0.5) * 4);
const spyMA20  = days.map((_, i) => {
  const w = spyPrice.slice(Math.max(0, i - 19), i + 1);
  return w.reduce((a, b) => a + b, 0) / w.length;
});
let spr = 0;
const spread = days.map(() => { spr = spr * 0.85 + (r2() - 0.5) * 1.2; return spr; });

// ─────────────────────────────────────────────────────────────
// SVG flowchart helper — real boxes + arrows, NOT ASCII art.
// nodes: [{ id, x, y, w, h, label, sub?, kind? }]   kind ∈ start|step|decision|terminal|emphasis
// edges: [{ from, to, label?, kind? }]              kind ∈ default|yes|no
// ─────────────────────────────────────────────────────────────
function svgFlowchart({ title, nodes, edges, width = 760, height = 460 }) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const kindFill = {
    start:    'var(--packt-blue-soft)', step: 'var(--chiron-surface)',
    decision: 'var(--packt-orange-soft)', terminal: 'var(--packt-green-soft)',
    emphasis: '#FFFCEC',
  };
  const kindStroke = {
    start: 'var(--packt-blue)', step: 'var(--chiron-border)',
    decision: 'var(--packt-orange)', terminal: 'var(--packt-green)',
    emphasis: 'var(--packt-orange)',
  };
  const kindLabelFill = {
    start: '#103a5c', step: 'var(--chiron-fg)',
    decision: '#7c2d12', terminal: '#14532d',
    emphasis: 'var(--chiron-fg)',
  };

  const shapes = nodes.map(n => {
    const fill = kindFill[n.kind || 'step'];
    const stroke = kindStroke[n.kind || 'step'];
    const labelFill = kindLabelFill[n.kind || 'step'];
    const { x, y, w, h } = n;
    const labelLines = n.label.split('\n');
    const subLines = (n.sub || '').split('\n').filter(Boolean);
    const lineH = 14;
    const blockH = (labelLines.length + subLines.length) * lineH;
    const startY = y + h/2 - blockH/2 + lineH * 0.75;
    const texts = labelLines.map((ln, i) =>
      `<text x="${x+w/2}" y="${startY + i*lineH}" text-anchor="middle" font-family="Lato, sans-serif" font-size="11.5" font-weight="700" fill="${labelFill}">${ln}</text>`).join('')
      + subLines.map((ln, i) =>
      `<text x="${x+w/2}" y="${startY + (labelLines.length+i)*lineH}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="${labelFill}" opacity="0.82">${ln}</text>`).join('');
    if (n.kind === 'decision') {
      const cx = x + w/2, cy = y + h/2;
      const d = `M ${cx},${y} L ${x+w},${cy} L ${cx},${y+h} L ${x},${cy} Z`;
      return `<g><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.75"/>${texts}</g>`;
    }
    const rx = (n.kind === 'terminal' || n.kind === 'start') ? 20 : 5;
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${texts}</g>`;
  }).join('');

  function anchor(n, towards) {
    const cx = n.x + n.w/2, cy = n.y + n.h/2;
    const tx = towards.x + towards.w/2, ty = towards.y + towards.h/2;
    const dx = tx - cx, dy = ty - cy;
    if (Math.abs(dy) >= Math.abs(dx)) {
      return dy > 0 ? { x: cx, y: n.y + n.h } : { x: cx, y: n.y };
    }
    return dx > 0 ? { x: n.x + n.w, y: cy } : { x: n.x, y: cy };
  }

  const edgeColor = { default: 'var(--chiron-fg-secondary)', yes: 'var(--packt-green)', no: 'var(--packt-orange)' };
  const arrows = edges.map(e => {
    const a = byId[e.from], b = byId[e.to];
    const start = anchor(a, b), end = anchor(b, a);
    const color = edgeColor[e.kind || 'default'];
    let path;
    if (Math.abs(start.x - end.x) < 4 || Math.abs(start.y - end.y) < 4) {
      path = `M ${start.x},${start.y} L ${end.x},${end.y}`;
    } else {
      const midY = (start.y + end.y) / 2;
      path = `M ${start.x},${start.y} L ${start.x},${midY} L ${end.x},${midY} L ${end.x},${end.y}`;
    }
    let label = '';
    if (e.label) {
      const lx = (start.x + end.x) / 2, ly = (start.y + end.y) / 2;
      label = `<rect x="${lx-16}" y="${ly-9}" width="32" height="18" rx="3" fill="white" stroke="${color}" stroke-width="0.75"/><text x="${lx}" y="${ly+5}" text-anchor="middle" font-family="Lato, sans-serif" font-size="10" font-weight="700" fill="${color}">${e.label}</text>`;
    }
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.75" marker-end="url(#flow-arrow-${e.kind || 'default'})"/>${label}`;
  }).join('');

  const markers = `
    <defs>
      <marker id="flow-arrow-default" viewBox="0 -5 10 10" refX="9" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-4 L10,0 L0,4 Z" fill="var(--chiron-fg-secondary)"/></marker>
      <marker id="flow-arrow-yes"     viewBox="0 -5 10 10" refX="9" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-4 L10,0 L0,4 Z" fill="var(--packt-green)"/></marker>
      <marker id="flow-arrow-no"      viewBox="0 -5 10 10" refX="9" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-4 L10,0 L0,4 Z" fill="var(--packt-orange)"/></marker>
    </defs>`;
  return `
<figure class="flowchart">
  ${title ? `<figcaption>${title}</figcaption>` : ''}
  <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${title || 'flowchart'}">
    ${markers}${arrows}${shapes}
  </svg>
</figure>`;
}

// ─────────────────────────────────────────────────────────────
// Comparison-card pair — side-by-side worked-example cards.
// items: [{ label, formula, result, badge? }]   badge ∈ winner|loser|warn
// ─────────────────────────────────────────────────────────────
function comparisonCards({ title, items, takeaway }) {
  const cards = items.map(it => `
    <div class="cmp-card${it.badge ? ' cmp-card--' + it.badge : ''}">
      <div class="cmp-card-label">${it.label}</div>
      <div class="cmp-card-formula">${it.formula}</div>
      <div class="cmp-card-result">${it.result}</div>
      ${it.badge ? `<div class="cmp-card-badge">${it.badge.toUpperCase()}</div>` : ''}
    </div>`).join('');
  return `
<div class="cmp-block">
  ${title ? `<div class="cmp-title">${title}</div>` : ''}
  <div class="cmp-grid">${cards}</div>
  ${takeaway ? `<div class="cmp-takeaway">${takeaway}</div>` : ''}
</div>`;
}

function svgLineChart({ title, xLabel, yLabel, series, height = 240, width = 720 }) {
  const ML = 56, MR = 16, MT = 28, MB = 36;
  const PW = width - ML - MR, PH = height - MT - MB;
  const allX = series.flatMap(s => s.points.map(p => p.x));
  const allY = series.flatMap(s => s.points.map(p => p.y));
  let xMin = Math.min(...allX), xMax = Math.max(...allX);
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xPad = (xMax - xMin) * 0.04 || 1;
  const yPad = (yMax - yMin) * 0.06 || 1;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
  const sx = x => ML + ((x - xMin) / (xMax - xMin)) * PW;
  const sy = y => MT + PH - ((y - yMin) / (yMax - yMin)) * PH;
  const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const fmt = (n) => Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);

  const grid = [
    ...ticks(xMin, xMax, 4).map(x => `<line x1="${sx(x).toFixed(1)}" y1="${MT}" x2="${sx(x).toFixed(1)}" y2="${MT + PH}" stroke="var(--chiron-divider)" stroke-width="0.5" stroke-dasharray="2 3"/>`),
    ...ticks(yMin, yMax, 4).map(y => `<line x1="${ML}" y1="${sy(y).toFixed(1)}" x2="${ML + PW}" y2="${sy(y).toFixed(1)}" stroke="var(--chiron-divider)" stroke-width="0.5" stroke-dasharray="2 3"/>`),
  ].join('');
  const xLabels = ticks(xMin, xMax, 4).map(x => `<text x="${sx(x).toFixed(1)}" y="${MT + PH + 14}" text-anchor="middle" font-family="Consolas, monospace" font-size="10" fill="var(--chiron-muted, #6b7280)">${fmt(x)}</text>`).join('');
  const yLabels = ticks(yMin, yMax, 4).map(y => `<text x="${ML - 6}" y="${(sy(y) + 4).toFixed(1)}" text-anchor="end" font-family="Consolas, monospace" font-size="10" fill="var(--chiron-muted, #6b7280)">${fmt(y)}</text>`).join('');

  const lines = series.map((s, i) => {
    const stroke = s.color || ['var(--packt-orange)', 'var(--packt-blue)', 'var(--packt-green)', 'var(--packt-purple)'][i % 4];
    const d = s.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join('');
  const legend = series.map((s, i) => {
    const stroke = s.color || ['var(--packt-orange)', 'var(--packt-blue)', 'var(--packt-green)', 'var(--packt-purple)'][i % 4];
    return `<span class="legend-item"><span class="legend-swatch" style="background:${stroke}"></span>${s.label}</span>`;
  }).join('');

  return `
<figure class="chart-svg">
  <figcaption>${title}</figcaption>
  <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${title}">
    <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="var(--chiron-surface, #fafafa)" stroke="none"/>
    ${grid}
    ${lines}
    <line x1="${ML}" y1="${MT + PH}" x2="${ML + PW}" y2="${MT + PH}" stroke="var(--chiron-border)" stroke-width="1"/>
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + PH}" stroke="var(--chiron-border)" stroke-width="1"/>
    ${xLabels}${yLabels}
    ${xLabel ? `<text x="${ML + PW / 2}" y="${height - 4}" text-anchor="middle" font-family="Consolas, monospace" font-size="10.5" fill="var(--chiron-muted, #6b7280)" letter-spacing=".06em">${xLabel.toUpperCase()}</text>` : ''}
    ${yLabel ? `<text x="14" y="${MT + PH / 2}" text-anchor="middle" transform="rotate(-90 14 ${MT + PH / 2})" font-family="Consolas, monospace" font-size="10.5" fill="var(--chiron-muted, #6b7280)" letter-spacing=".06em">${yLabel.toUpperCase()}</text>` : ''}
  </svg>
  <div class="legend">${legend}</div>
</figure>`;
}

// ─────────────────────────────────────────────────────────────
// Packt-style block helpers
// ─────────────────────────────────────────────────────────────
function objectives(items) {
  return `
<div class="learning-objectives">
  <div class="objectives-header">By the end of this chapter, you will be able to:</div>
  <ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
</div>`;
}
function technicalRequirements(items) {
  return `
<aside class="tech-req">
  <div class="tech-req-header">⚙ Technical Requirements</div>
  <ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
</aside>`;
}
function admonition(kind, body) {
  const icons = { note: 'ℹ', tip: '💡', warning: '⚠', 'best-practice': '★', 'hands-on': '✎' };
  const titles = { note: 'Note', tip: 'Tip', warning: 'Warning', 'best-practice': 'Best Practice', 'hands-on': 'Hands-on Exercise' };
  return `
<div class="admonition admonition-${kind}">
  <div class="admonition-title"><span class="admonition-icon">${icons[kind]}</span><span>${titles[kind]}</span></div>
  <div class="admonition-body">${body}</div>
</div>`;
}
function summary(items) {
  return `
<div class="chapter-summary">
  <h2>Summary</h2>
  <p>In this chapter you learned:</p>
  <ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
</div>`;
}

// ─────────────────────────────────────────────────────────────
// Chapters — Packt-shape content
// ─────────────────────────────────────────────────────────────
const chapters = [
  {
    id: 'ch1', num: 1, title: 'Birth of a bill — drafting and introduction',
    subSections: [
      { id: 'forms-of-legislation', title: 'Bills vs resolutions' },
      { id: 'drafting', title: 'Who drafts the text' },
      { id: 'sponsorship', title: 'Sponsorship and co-sponsors' },
      { id: 'introduction', title: 'Introduction and numbering' },
      { id: 'overview-flow', title: 'The full path (overview)' },
    ],
    body: `
      ${objectives([
        'Distinguish a <strong>bill</strong> from joint, concurrent, and simple <strong>resolutions</strong>.',
        'Explain how Congressional bill numbers (H.R. vs S.) are assigned.',
        'Identify who actually writes the text of a federal bill.',
        'Trace the full path a bill follows from introduction to law.',
      ])}
      ${technicalRequirements([
        'A free account at <code>congress.gov</code> to track a real bill.',
        'Familiarity with U.S. Constitution Article I (legislative powers).',
      ])}
      <p>The Constitution gives "all legislative powers herein granted" to Congress (Article I §1). What it does NOT say is who may introduce a bill. By two centuries of tradition, the answer is: only a sitting member of the chamber where the bill originates.</p>

      <h2 id="forms-of-legislation">Bills vs resolutions</h2>
      <p>Not every document Congress passes becomes law. Four forms exist, and only two ever land on the President's desk:</p>
      <table class="scheme-table">
        <thead><tr><th>Form</th><th>Designation</th><th>Becomes law?</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><strong>Bill</strong></td><td>H.R. # / S. #</td><td>Yes</td><td>Most legislation</td></tr>
          <tr><td><strong>Joint resolution</strong></td><td>H.J. Res. # / S.J. Res. #</td><td>Yes (mostly)</td><td>Continuing appropriations, war powers, proposed constitutional amendments (these go directly to the states, not the President)</td></tr>
          <tr><td><strong>Concurrent resolution</strong></td><td>H. Con. Res. # / S. Con. Res. #</td><td>No</td><td>Bi-chamber statements; budget framework</td></tr>
          <tr><td><strong>Simple resolution</strong></td><td>H. Res. # / S. Res. #</td><td>No</td><td>Internal chamber rules; one-chamber statements</td></tr>
        </tbody>
      </table>

      ${admonition('note', '<p>A <strong>joint resolution proposing a constitutional amendment</strong> is the one exception that bypasses the President entirely. Once both chambers pass it by 2/3 majority, it goes directly to the states for ratification.</p>')}

      <h2 id="drafting">Who drafts the text</h2>
      <p>Members rarely write the text themselves. Real authorship usually involves:</p>
      <ul>
        <li><strong>Member personal staff</strong> — initial outline, political framing.</li>
        <li><strong>Office of Legislative Counsel</strong> — House and Senate each maintain a non-partisan attorney office that translates policy intent into statutory language. This is the technical drafting step.</li>
        <li><strong>Lobbyists, executive agencies, outside policy shops</strong> — frequently supply working drafts the member then sponsors.</li>
        <li><strong>Government Publishing Office</strong> — handles typesetting and version control once introduced.</li>
      </ul>

      ${admonition('hands-on', '<p>Pick any recent bill at <code>congress.gov/bill</code>. Click "Text" → "View Text Comparison." You will see <em>multiple versions</em> of the same bill — <strong>introduced</strong>, <strong>reported in committee</strong>, <strong>engrossed</strong> (passed by originating chamber), <strong>received</strong> (in the other chamber), <strong>enrolled</strong> (final agreed text). This is the same artifact mutating as it moves through the gauntlet.</p>')}

      <h2 id="sponsorship">Sponsorship and co-sponsors</h2>
      <p>Every bill has exactly <strong>one sponsor</strong> (the member who introduces it). Other members may sign on as <strong>co-sponsors</strong>. Co-sponsors signal political support but have no procedural power.</p>

      ${admonition('tip', '<p>Co-sponsor counts are a useful but noisy proxy for momentum. A high count <em>plus</em> committee chair support is the strongest predictor of forward motion. A high count <em>without</em> chair support usually means the bill dies in committee with a long signatory list.</p>')}

      <h2 id="introduction">Introduction and numbering</h2>
      <ol class="protocol">
        <li><strong>House</strong>: sponsor drops a copy in the <em>hopper</em> (a wooden box on the Clerk's desk).</li>
        <li><strong>Senate</strong>: sponsor rises during morning hour and addresses the presiding officer.</li>
        <li><strong>Numbering</strong>: Clerk assigns the next sequential number prefixed with the chamber (H.R. 1, H.R. 2 in the House; S. 1, S. 2 in the Senate). Numbers reset every Congress (a 2-year cycle).</li>
        <li><strong>First reading</strong>: title read into the record.</li>
        <li><strong>Referral</strong>: chamber parliamentarian assigns the bill to one or more committees based on jurisdiction.</li>
      </ol>

      <pre class="code-block"><span class="code-lang">JSON · bill metadata (congress.gov-style)</span>
<code>{
  <span class="cm-string">"bill_id"</span>: <span class="cm-string">"hr1234-118"</span>,
  <span class="cm-string">"congress"</span>: <span class="cm-num">118</span>,
  <span class="cm-string">"type"</span>: <span class="cm-string">"hr"</span>,                    <span class="cm-comment">// hr | s | hjres | sjres | hconres | sconres | hres | sres</span>
  <span class="cm-string">"number"</span>: <span class="cm-num">1234</span>,
  <span class="cm-string">"title"</span>: <span class="cm-string">"To amend title 18, United States Code, to ..."</span>,
  <span class="cm-string">"sponsor"</span>: { <span class="cm-string">"bioguide_id"</span>: <span class="cm-string">"S001234"</span>, <span class="cm-string">"name"</span>: <span class="cm-string">"Smith, John"</span>, <span class="cm-string">"party"</span>: <span class="cm-string">"D"</span>, <span class="cm-string">"state"</span>: <span class="cm-string">"CA"</span> },
  <span class="cm-string">"cosponsors_count"</span>: <span class="cm-num">42</span>,
  <span class="cm-string">"introduced_date"</span>: <span class="cm-string">"2026-02-15"</span>,
  <span class="cm-string">"committees"</span>: [<span class="cm-string">"hsju00"</span>, <span class="cm-string">"hsif00"</span>],
  <span class="cm-string">"current_status"</span>: <span class="cm-string">"in_committee"</span>     <span class="cm-comment">// introduced | in_committee | reported | passed_chamber | passed_both | to_president | enacted | vetoed | dead</span>
}</code></pre>

      <h2 id="overview-flow">The full path (overview)</h2>
      ${svgFlowchart({
        title: 'A bill from introduction to law — the canonical path',
        width: 760, height: 600,
        nodes: [
          { id: 'b1', x: 280, y:  10, w: 200, h: 50, kind: 'start', label: 'Introduced', sub: 'H.R. # or S. #' },
          { id: 'b2', x: 280, y:  90, w: 200, h: 50, kind: 'step',  label: 'Referred to committee' },
          { id: 'b3', x: 280, y: 170, w: 200, h: 70, kind: 'decision', label: 'Markup + report?' },
          { id: 'b4', x:  30, y: 175, w: 180, h: 60, kind: 'emphasis', label: 'Dies in committee', sub: '~90% of bills' },
          { id: 'b5', x: 280, y: 280, w: 200, h: 50, kind: 'step',  label: 'Floor debate + vote' },
          { id: 'b6', x: 280, y: 360, w: 200, h: 70, kind: 'decision', label: 'Other chamber passes identical?' },
          { id: 'b7', x:  30, y: 365, w: 180, h: 60, kind: 'step',  label: 'Conference / ping-pong' },
          { id: 'b8', x: 280, y: 470, w: 200, h: 50, kind: 'step',  label: 'Enrolled → President' },
          { id: 'b9', x: 280, y: 540, w: 200, h: 50, kind: 'terminal', label: 'Becomes law' },
        ],
        edges: [
          { from: 'b1', to: 'b2' },
          { from: 'b2', to: 'b3' },
          { from: 'b3', to: 'b4', label: 'NO',  kind: 'no' },
          { from: 'b3', to: 'b5', label: 'YES', kind: 'yes' },
          { from: 'b5', to: 'b6' },
          { from: 'b6', to: 'b7', label: 'NO',  kind: 'no' },
          { from: 'b7', to: 'b8' },
          { from: 'b6', to: 'b8', label: 'YES', kind: 'yes' },
          { from: 'b8', to: 'b9' },
        ],
      })}
      <p>Every chapter that follows zooms into one box on this diagram.</p>

      ${summary([
        'Four legislative forms exist; only bills and most joint resolutions become law.',
        'Members rarely draft the text themselves — Legislative Counsel and lobbyists supply working language.',
        'Sponsor count is one signal; chair support is the decisive one.',
        'The bill text mutates through five named versions: introduced → reported → engrossed → received → enrolled.',
      ])}
    `,
  },

  {
    id: 'ch2', num: 2, title: 'Committee stage — where most bills die',
    subSections: [
      { id: 'why-committee', title: 'Why committees exist' },
      { id: 'committee-types', title: 'Types of committees' },
      { id: 'subcommittee', title: 'Subcommittee work' },
      { id: 'markup', title: 'Markup and reporting' },
      { id: 'discharge', title: 'Discharge petition (escape hatch)' },
    ],
    body: `
      ${objectives([
        'Explain why <strong>~90%</strong> of bills die in committee.',
        'Identify the four types of Congressional committees.',
        'Describe a markup session: what amendments can be offered and how votes are tallied.',
        'Use a discharge petition to bypass a hostile committee chair.',
      ])}

      <p>If a bill ever became a "how a bill becomes a law" cliche, the committee stage is the bottleneck the cliche skips. <strong>This is where most bills die.</strong> Understanding why is the single most important lesson in legislative process.</p>

      <h2 id="why-committee">Why committees exist</h2>
      <p>Congress has 535 members and tens of thousands of bills per session. No member can read every bill. The committee system is the division of labor that makes legislating tractable: each committee specializes in a policy domain (Judiciary, Armed Services, Ways and Means, Energy and Commerce) and does the deep technical work on bills referred to it.</p>

      ${admonition('warning', '<p>Committee chairs are powerful. The chair controls the agenda. <strong>If the chair refuses to schedule a hearing, the bill is effectively dead</strong> — there is no countdown, no automatic discharge, no procedural escape unless the full chamber forces it (see Discharge Petition below).</p>')}

      <h2 id="committee-types">Types of committees</h2>
      <table class="scheme-table">
        <thead><tr><th>Type</th><th>Lifespan</th><th>Purpose</th><th>Example</th></tr></thead>
        <tbody>
          <tr><td><strong>Standing</strong></td><td>Permanent</td><td>Workhorse — drafts and reports bills</td><td>House Judiciary, Senate Finance</td></tr>
          <tr><td><strong>Select / Special</strong></td><td>Time-limited</td><td>Investigation or focused study</td><td>House January 6th Select Committee</td></tr>
          <tr><td><strong>Joint</strong></td><td>Permanent</td><td>Both chambers; usually study-only</td><td>Joint Economic Committee</td></tr>
          <tr><td><strong>Conference</strong></td><td>One-bill</td><td>Reconcile House and Senate versions</td><td>Ad-hoc per bill</td></tr>
        </tbody>
      </table>

      <h2 id="subcommittee">Subcommittee work</h2>
      <p>Most committees split into <strong>subcommittees</strong> with narrower jurisdiction. A bill is typically referred from full committee down to the appropriate subcommittee, which holds hearings (witnesses, expert testimony) and then either reports the bill back to full committee or lets it die.</p>

      <h2 id="markup">Markup and reporting</h2>
      <p>A markup is the working session where the committee literally <em>marks up</em> the bill — proposes amendments, debates, votes, and decides whether to advance.</p>
      <ol class="protocol">
        <li><strong>Amendments offered</strong> — any committee member may propose. Amendments debated and voted on individually.</li>
        <li><strong>Amendment in the nature of a substitute</strong> — a rewrite of the entire bill. Common tactic to clean up or radically reshape.</li>
        <li><strong>Final vote</strong> — committee votes on the (now-amended) bill: report favorably, unfavorably, or without recommendation.</li>
        <li><strong>Committee report</strong> — formal written document explaining the bill, amendments, and dissenting views. Becomes part of the legislative history courts rely on.</li>
      </ol>

      ${admonition('best-practice', '<p>Legislative history matters. If you ever read a Supreme Court opinion that interprets statutory language, you will see citations to the <em>committee report</em>. Courts use committee reports to determine Congressional intent when text is ambiguous. <strong>Write the committee report carefully if you ever staff one.</strong></p>')}

      <h2 id="discharge">Discharge petition (escape hatch)</h2>
      <p>What if the committee chair refuses to act? The House has a rarely-used procedure: the <strong>discharge petition</strong>. If 218 members (a House majority) sign, the bill is "discharged" from committee and goes directly to the floor.</p>

      ${admonition('note', '<p>Discharge petitions are <em>extremely rare</em>. The leadership of both parties historically discourage them — they break the unwritten committee-respect rules. About one bill per Congress actually clears the discharge threshold. The Senate has no direct equivalent (Rule XIV and unanimous-consent workarounds exist).</p>')}

      ${summary([
        'Most bills die because the committee chair never schedules a hearing.',
        'Four committee types: standing (workhorse), select (focused), joint (both chambers), conference (reconciliation).',
        'Markup = the working session where amendments are voted on and the bill is reported.',
        'Committee reports become legislative history; courts use them to interpret intent.',
        'Discharge petition is the House escape hatch — 218 signatures — but rarely succeeds.',
      ])}
    `,
  },

  {
    id: 'ch3', num: 3, title: 'Floor consideration — debate, amendment, vote',
    subSections: [
      { id: 'house-vs-senate', title: 'House vs Senate procedure' },
      { id: 'rules-committee', title: 'House Rules Committee' },
      { id: 'filibuster', title: 'Senate filibuster + cloture' },
      { id: 'votes', title: 'Vote types' },
    ],
    body: `
      ${objectives([
        'Compare House and Senate floor procedure.',
        'Explain how the <strong>House Rules Committee</strong> shapes debate and amendment.',
        'Define the <strong>filibuster</strong> and how cloture (60 votes) ends it.',
        'Identify voice, division, roll call, and electronic vote tally types.',
      ])}

      <p>The two chambers run their floors very differently. The House is majoritarian and tightly controlled by its Rules Committee. The Senate is consensus-driven and gives individual senators enormous leverage via the filibuster.</p>

      <h2 id="house-vs-senate">House vs Senate procedure</h2>
      ${comparisonCards({
        title: 'Floor procedure side-by-side',
        items: [
          { label: 'HOUSE (435 members)', formula: 'Majority rules · debate strictly time-limited', result: 'Rules Committee dictates debate', badge: 'warn' },
          { label: 'SENATE (100 members)', formula: 'Unlimited debate unless 60 vote for cloture', result: 'Filibuster default; UC overrides', badge: 'warn' },
        ],
        takeaway: 'Same bill text, two very different gauntlets. A bill that sails through the House may die on a Senate filibuster — or vice versa.',
      })}

      <h2 id="rules-committee">House Rules Committee</h2>
      <p>The Rules Committee writes a <strong>rule</strong> for each bill specifying: (a) total debate time, (b) which amendments may be offered. Three rule types:</p>
      <table class="scheme-table">
        <thead><tr><th>Rule type</th><th>Amendments allowed</th><th>Typical use</th></tr></thead>
        <tbody>
          <tr><td><strong>Open</strong></td><td>Any germane amendment</td><td>Appropriations; low-stakes bills</td></tr>
          <tr><td><strong>Closed</strong></td><td>None</td><td>Leadership priorities; tax bills</td></tr>
          <tr><td><strong>Structured / modified</strong></td><td>Only pre-listed amendments</td><td>Most major legislation today</td></tr>
        </tbody>
      </table>

      ${admonition('tip', '<p>The shift to <strong>closed and structured rules</strong> over the last 30 years is the single biggest change in how the House operates. In the 1970s, ~85% of rules were open; today, <strong>less than 5%</strong> are open.</p>')}

      <h2 id="filibuster">Senate filibuster + cloture</h2>
      <p>Any senator may speak indefinitely on any matter (with rare exceptions like budget reconciliation). To end debate against the speaker will requires <strong>cloture</strong> — a successful motion under Rule XXII, requiring <strong>60 votes</strong>.</p>

      ${admonition('warning', '<p>The 60-vote cloture threshold is why Senate bills usually require <strong>bipartisan support</strong>. In a 51-49 Senate, the minority can simply refuse cloture and the bill dies — even if a simple majority supports it. This is the most important structural fact in modern Senate procedure.</p>')}

      <p><strong>Budget reconciliation</strong> is the major workaround: bills affecting federal revenue, spending, or the debt limit may be passed by simple majority, bypassing the filibuster. But reconciliation is constrained by the <em>Byrd Rule</em> — provisions must be primarily fiscal, not policy. The Senate Parliamentarian polices this and can strip non-compliant provisions.</p>

      <h2 id="votes">Vote types</h2>
      <table class="scheme-table">
        <thead><tr><th>Type</th><th>How it works</th><th>When used</th></tr></thead>
        <tbody>
          <tr><td><strong>Voice vote</strong></td><td>Presiding officer calls aye/nay; judges by volume</td><td>Routine, uncontested matters</td></tr>
          <tr><td><strong>Division</strong></td><td>Members stand to be counted</td><td>When voice vote is disputed</td></tr>
          <tr><td><strong>Roll call (Senate)</strong></td><td>Clerk calls each name; vote recorded</td><td>Substantive votes; on request</td></tr>
          <tr><td><strong>Electronic (House)</strong></td><td>Members swipe cards; tallied automatically</td><td>Most votes in modern House</td></tr>
        </tbody>
      </table>

      ${summary([
        'House: majoritarian; Rules Committee dictates debate; closed/structured rules dominate today.',
        'Senate: filibuster default; 60 votes for cloture.',
        'Budget reconciliation bypasses filibuster but is constrained by the Byrd Rule.',
        'Four vote-recording types — voice, division, roll call, electronic.',
      ])}
    `,
  },

  {
    id: 'ch4', num: 4, title: 'Second chamber + reconciliation',
    subSections: [
      { id: 'identical-bill', title: 'The identical-bill problem' },
      { id: 'conference', title: 'Conference committee' },
      { id: 'ping-pong', title: 'Ping-pong (amendments between chambers)' },
    ],
    body: `
      ${objectives([
        'Explain why both chambers must pass <strong>identical</strong> bill text.',
        'Describe the role of a conference committee.',
        'Compare conference vs ping-pong reconciliation.',
      ])}

      <h2 id="identical-bill">The identical-bill problem</h2>
      <p>After chamber A passes a bill, it is engrossed and sent to chamber B. B has four options:</p>
      <ol class="protocol">
        <li><strong>Pass the version as-is</strong> — rare; immediately enrolled and sent to President.</li>
        <li><strong>Amend it</strong> — send back to A with B changes.</li>
        <li><strong>Refuse to act</strong> — bill dies at the end of Congress.</li>
        <li><strong>Substitute its own version</strong> — typical for major bills; triggers reconciliation.</li>
      </ol>
      <p><strong>The Constitution requires identical text from both chambers</strong> before a bill goes to the President. Differences must be reconciled.</p>

      <h2 id="conference">Conference committee</h2>
      <p>Historically the standard reconciliation mechanism: leadership of both chambers appoints conferees (typically committee chairs + ranking members) to a temporary <strong>conference committee</strong>. Conferees negotiate a unified text, then each chamber votes <strong>up-or-down on the conference report</strong> — no further amendments allowed.</p>

      ${admonition('note', '<p>Conference reports are voted as a single take-it-or-leave-it package. This is enormous power for the conferees: they effectively rewrite the bill and the full chambers can only accept or reject the rewrite. Conferees often include provisions <em>neither original chamber had passed</em> (called "airdropped"). This has triggered ethics and transparency reforms in recent decades.</p>')}

      <h2 id="ping-pong">Ping-pong (amendments between chambers)</h2>
      <p>Increasingly, leadership skips the formal conference and uses <strong>"ping-pong"</strong>: chamber A amends B amendment, sends back to B, which amends again, until both pass identical text. This concentrates power in leadership offices (Speaker + Majority Leader) rather than committee chairs.</p>

      ${admonition('hands-on', '<p>Find a recent omnibus appropriations bill at <code>congress.gov</code>. Click "Actions." Look for the entry "Resolving differences — agreed to without amendment." That is the modern ping-pong endpoint. Compare to a bill from the 1990s — you will see "Conference report agreed to" instead.</p>')}

      ${summary([
        'The Constitution requires identical text from both chambers before the President can sign.',
        'Conference committees are the historical reconciliation mechanism but rare today.',
        'Ping-pong (mutual amendment) is the modern default, concentrating power in leadership.',
        'Conference reports are voted take-it-or-leave-it — enormous power for conferees.',
      ])}
    `,
  },

  {
    id: 'ch5', num: 5, title: `President's desk — five fates`,
    subSections: [
      { id: 'ten-day-clock', title: 'The 10-day clock' },
      { id: 'five-outcomes', title: 'Five possible outcomes' },
      { id: 'pocket-veto', title: 'The pocket-veto trap' },
      { id: 'override', title: 'Veto override math' },
      { id: 'flow', title: 'Decision tree' },
    ],
    body: `
      ${objectives([
        'List the <strong>five</strong> outcomes when a bill reaches the President.',
        'Explain why timing of Congressional adjournment matters (pocket veto).',
        'Compute the override math: 2/3 of each chamber.',
        'Identify why the line-item veto no longer exists.',
      ])}

      <h2 id="ten-day-clock">The 10-day clock</h2>
      <p>Once Congress sends an enrolled bill to the President, the Constitution (Article I §7) gives him <strong>10 days</strong> (excluding Sundays) to act. The clock starts when the bill is physically received at the White House.</p>

      <h2 id="five-outcomes">Five possible outcomes</h2>
      <table class="scheme-table">
        <thead><tr><th>#</th><th>Action</th><th>Becomes law?</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>1</td><td><strong>Sign</strong></td><td>Yes</td><td>Standard. Often accompanied by a signing statement.</td></tr>
          <tr><td>2</td><td><strong>Veto + return</strong></td><td>No, unless overridden</td><td>Returned to the originating chamber with written objections.</td></tr>
          <tr><td>3</td><td><strong>Pocket veto</strong></td><td>No</td><td>10-day window expires while Congress is adjourned. No override possible.</td></tr>
          <tr><td>4</td><td><strong>Allow without signature</strong></td><td>Yes</td><td>10 days expire while Congress is in session. Symbolic protest.</td></tr>
          <tr><td>5</td><td><strong>Line-item veto</strong></td><td>—</td><td>Briefly existed (1996); struck down in <em>Clinton v. City of New York</em> (1998) as unconstitutional.</td></tr>
        </tbody>
      </table>

      <h2 id="pocket-veto">The pocket-veto trap</h2>
      ${admonition('warning', '<p><strong>The pocket veto is undeprivable.</strong> If Congress sends a bill late in a session and then adjourns sine die before the 10-day clock expires, the President can simply do nothing. The bill dies. There is no return-with-objections, no override opportunity — Congress is gone. This is why end-of-session bills are sent strategically.</p>')}

      <h2 id="override">Veto override math</h2>
      <div class="math-callout">
        \\[ \\text{Override} \\iff (\\text{House yes} \\geq \\tfrac{2}{3}) \\land (\\text{Senate yes} \\geq \\tfrac{2}{3}) \\]
        <div class="math-cite">Override requires 2/3 of those <em>present and voting</em> in each chamber.</div>
      </div>
      <p>Historically <strong>fewer than 5% of vetoes</strong> are overridden. The 2/3 supermajority is the practical floor that makes the veto a strong tool.</p>

      <h2 id="flow">Decision tree</h2>
      ${svgFlowchart({
        title: 'Presidential decision tree (Article I §7)',
        width: 760, height: 500,
        nodes: [
          { id: 'p1', x: 280, y:  10, w: 200, h: 50, kind: 'start', label: 'Bill arrives at White House' },
          { id: 'p2', x: 280, y:  90, w: 200, h: 70, kind: 'decision', label: 'President signs?' },
          { id: 'p3', x:  30, y:  95, w: 180, h: 50, kind: 'terminal', label: 'Becomes law' },
          { id: 'p4', x: 280, y: 200, w: 200, h: 70, kind: 'decision', label: 'Returns with veto?' },
          { id: 'p5', x: 530, y: 205, w: 200, h: 60, kind: 'decision', label: 'Congress adjourned at day 10?' },
          { id: 'p6', x: 530, y: 310, w: 200, h: 50, kind: 'emphasis', label: 'POCKET VETO', sub: 'bill dies' },
          { id: 'p7', x: 280, y: 310, w: 200, h: 50, kind: 'step', label: 'Override attempt' },
          { id: 'p8', x: 280, y: 390, w: 200, h: 70, kind: 'decision', label: '2/3 in BOTH chambers?' },
          { id: 'p9', x:  30, y: 395, w: 180, h: 50, kind: 'emphasis', label: 'Bill dies', sub: '~95% of attempts' },
          { id: 'pA', x: 530, y: 395, w: 180, h: 50, kind: 'terminal', label: 'Becomes law' },
        ],
        edges: [
          { from: 'p1', to: 'p2' },
          { from: 'p2', to: 'p3', label: 'YES', kind: 'yes' },
          { from: 'p2', to: 'p4', label: 'NO',  kind: 'no' },
          { from: 'p4', to: 'p7', label: 'YES', kind: 'yes' },
          { from: 'p4', to: 'p5', label: 'NO',  kind: 'no' },
          { from: 'p5', to: 'p6', label: 'YES', kind: 'yes' },
          { from: 'p7', to: 'p8' },
          { from: 'p8', to: 'p9', label: 'NO',  kind: 'no' },
          { from: 'p8', to: 'pA', label: 'YES', kind: 'yes' },
        ],
      })}

      ${summary([
        'Five outcomes — sign, veto, pocket veto, allow-without-signature, (defunct line-item veto).',
        'Pocket veto requires Congressional adjournment during the 10-day window — no override possible.',
        'Override math: 2/3 of each chamber; succeeds in fewer than 5% of attempts.',
        'Line-item veto was struck down in Clinton v. City of New York (1998).',
      ])}
    `,
  },

  {
    id: 'ch6', num: 6, title: 'After becoming law — rulemaking, courts, repeal',
    subSections: [
      { id: 'codification', title: 'Public Law → U.S. Code' },
      { id: 'rulemaking', title: 'Agency rulemaking under the APA' },
      { id: 'judicial-review', title: 'Judicial review' },
      { id: 'repeal', title: 'Repeal + sunset' },
      { id: 'cheat-sheet', title: 'Cheat sheet — fates of a bill' },
    ],
    body: `
      ${objectives([
        'Trace a statute from signature to <strong>U.S. Code</strong> codification.',
        'Explain the APA <strong>notice-and-comment</strong> rulemaking process.',
        'Identify the judicial-review pathways that can strike or narrow a statute.',
        'Explain the three ways a law ends: repeal, sunset, judicial invalidation.',
      ])}

      <h2 id="codification">Public Law → U.S. Code</h2>
      <p>The moment the bill becomes law, it is assigned a <strong>Public Law number</strong> in the format <code>P.L. CCC-NNN</code> (e.g. <code>P.L. 117-103</code> = Congress 117, statute 103). It is then:</p>
      <ol class="protocol">
        <li><strong>Published in Statutes at Large</strong> — chronological record of all enacted statutes.</li>
        <li><strong>Codified into U.S. Code</strong> (USC) — the topical organization (Title 18 Crimes, Title 26 Tax, Title 42 Public Health). The Office of the Law Revision Counsel (House) maintains the USC.</li>
        <li><strong>Indexed</strong> for cross-references and prior-law amendments.</li>
      </ol>

      ${admonition('note', '<p>Statutes at Large is the <strong>authoritative</strong> text. The USC is "prima facie" evidence of the law but in rare cases of conflict, courts defer to Statutes at Large. A small number of USC titles have been "enacted as positive law" — for those, the USC is itself authoritative.</p>')}

      <h2 id="rulemaking">Agency rulemaking under the APA</h2>
      <p>Statutes rarely contain enough detail to be self-executing. Congress typically delegates implementation to executive agencies, which write <strong>regulations</strong> under the Administrative Procedure Act (APA, 1946).</p>
      <ol class="protocol">
        <li><strong>Notice of Proposed Rulemaking (NPRM)</strong> — agency publishes proposed rule in the Federal Register.</li>
        <li><strong>Public comment period</strong> — usually 30-60 days.</li>
        <li><strong>Final rule</strong> — agency responds to substantive comments, publishes final text.</li>
        <li><strong>Codified into Code of Federal Regulations</strong> (CFR), the regulatory parallel to USC.</li>
      </ol>

      ${admonition('best-practice', '<p>When tracing a real-world legal obligation, the chain is: <strong>Statute (USC) → Regulation (CFR) → Sub-regulatory guidance (agency manual)</strong>. Each layer narrows interpretation. To know what a regulated entity must <em>actually</em> do, you read all three — not just the statute.</p>')}

      <h2 id="judicial-review">Judicial review</h2>
      <p>Article III courts can strike or narrow statutes via:</p>
      <ul>
        <li><strong>Facial challenge</strong> — the statute is unconstitutional on its face.</li>
        <li><strong>As-applied challenge</strong> — the statute is unconstitutional as applied to this litigant.</li>
        <li><strong>Statutory interpretation</strong> — narrow the meaning to avoid constitutional problems ("constitutional avoidance").</li>
        <li><strong>Pre-emption</strong> — federal law overrides conflicting state law (Supremacy Clause).</li>
      </ul>
      <p>The Supreme Court is the final arbiter (since <em>Marbury v. Madison</em>, 1803).</p>

      <h2 id="repeal">Repeal + sunset</h2>
      <table class="scheme-table">
        <thead><tr><th>Mechanism</th><th>Triggered by</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><strong>Express repeal</strong></td><td>New statute</td><td>"X is hereby repealed." Requires the same gauntlet as original passage.</td></tr>
          <tr><td><strong>Implicit repeal</strong></td><td>Incompatible new statute</td><td>Courts disfavor; require clear conflict.</td></tr>
          <tr><td><strong>Sunset</strong></td><td>Self-executing expiration date</td><td>Common in surveillance and tax provisions; often re-authorized.</td></tr>
        </tbody>
      </table>

      <h2 id="cheat-sheet">Cheat sheet — fates of a bill</h2>
      <table class="scheme-table cheat-sheet">
        <thead><tr><th>Stage</th><th>How a bill dies here</th><th>Frequency</th></tr></thead>
        <tbody>
          <tr><td>Introduction</td><td>Never referred</td><td>Negligible — referral is automatic</td></tr>
          <tr><td>Committee</td><td>Chair refuses to schedule</td><td><strong>~90%</strong> die here</td></tr>
          <tr><td>Floor</td><td>Lose the vote, or filibuster</td><td>~5%</td></tr>
          <tr><td>Other chamber</td><td>Refuses to act / different version unresolved</td><td>~3%</td></tr>
          <tr><td>President</td><td>Veto (and override fails)</td><td>~1%</td></tr>
          <tr><td>Courts</td><td>Struck as unconstitutional</td><td>&lt;1% of enacted laws</td></tr>
          <tr><td>Successfully enacted and survives</td><td>—</td><td><strong>2-4%</strong> of introduced bills</td></tr>
        </tbody>
      </table>

      ${admonition('tip', '<p>"How a bill becomes a law" is the wrong question. The right question is: <strong>"How do 96% of bills die?"</strong> Once you internalize that, you understand why interest groups focus more on <em>blocking</em> bills than passing them — defense is much easier than offense in this system.</p>')}

      <p class="source-cite">References: U.S. Constitution Art. I §7 · Congressional Research Service, "How Our Laws Are Made" (Doc. 110-49) · Walter J. Oleszek, <em>Congressional Procedures and the Policy Process</em> · Marbury v. Madison, 5 U.S. 137 (1803) · Clinton v. City of New York, 524 U.S. 417 (1998) · Administrative Procedure Act, 5 U.S.C. § 551 et seq.</p>
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// Render lesson.html — Packt-shape (sidebar tree-TOC + breadcrumbs + chapter pane)
// ─────────────────────────────────────────────────────────────
const sidebarToc = chapters.map(c => `
  <li class="toc-chapter">
    <a class="toc-link toc-chapter-link" href="#${c.id}" data-target="${c.id}">
      <span class="toc-num">${c.num}.</span><span class="toc-title">${c.title}</span>
    </a>
    ${c.subSections && c.subSections.length ? `<ul class="toc-sub">${c.subSections.map(s =>
      `<li><a class="toc-link toc-sub-link" href="#${s.id}" data-target-id="${s.id}">${s.title}</a></li>`
    ).join('')}</ul>` : ''}
  </li>`).join('');

const chaptersHtml = chapters.map(c => `
  <section class="chapter" id="${c.id}" data-chapter="${c.num}">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="#" class="bc-link">Library</a>
      <span class="bc-sep">›</span>
      <a href="#" class="bc-link">${LESSON_TITLE}</a>
      <span class="bc-sep">›</span>
      <span class="bc-current">Chapter ${c.num}</span>
    </nav>
    <div class="ch-num">Chapter ${c.num}</div>
    <h1>${c.title}</h1>
    ${c.body}
  </section>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en" data-theme="warm-paper" data-layout="l5" data-view="lesson">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${LESSON_TITLE}</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;600;700&family=Open+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />

  <script>
    window.MathJax = {
      tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] },
      options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'] },
      startup: { typeset: true }
    };
  </script>
  <script src="vendor/mathjax/tex-mml-chtml.js" id="MathJax-script" async></script>

  <style>
    /* ────────────────────────────────────────────────────────────
       PACKT-INSPIRED LAYER — overrides on top of chiron theme tokens.
       Packt brand orange #F04E23 is exposed as --packt-orange and
       used for accents (admonition Warning, primary buttons, TOC active).
       All other colours still flow from chiron theme tokens so the
       theme switcher continues to work.
       ──────────────────────────────────────────────────────────── */
    :root {
      --packt-orange: #F04E23;
      --packt-orange-soft: #FFF4E5;
      --packt-blue: #007BFF;
      --packt-blue-soft: #E7F3FF;
      --packt-green: #28A745;
      --packt-green-soft: #E6F4EA;
      --packt-purple: #6F42C1;
      --packt-gray-soft: #F1F1F1;
      --packt-code-bg: #282C34;
      --packt-code-fg: #ABB2BF;
      --packt-code-kw: #C678DD;
      --packt-code-string: #98C379;
      --packt-code-comment: #5C6370;
      --packt-code-num: #D19A66;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      display: grid; grid-template-columns: 260px 1fr; min-height: 100vh;
      background: var(--chiron-bg);
      color: var(--chiron-fg);
      font-family: 'Lato', 'Open Sans', -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.7;
    }

    /* ── Sidebar (tree-view TOC) ── */
    aside.side {
      background: var(--chiron-surface);
      border-right: 1px solid var(--chiron-border);
      padding: 1.5rem 1.25rem;
      overflow-y: auto;
      height: 100vh;
      position: sticky; top: 0;
    }
    .side .brand {
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 1rem;
      color: var(--packt-orange); letter-spacing: -0.01em;
    }
    .side .brand-sub {
      font-size: 0.72rem; color: var(--chiron-fg-secondary);
      margin-top: 4px; line-height: 1.4; font-weight: 400;
    }
    .side .toc-header {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em;
      color: var(--chiron-fg-secondary);
      margin: 1.75rem 0 0.5rem;
    }
    .side ul.toc-root { list-style: none; padding: 0; margin: 0; }
    .side .toc-chapter { margin-bottom: 0.25rem; }
    .side .toc-link {
      display: flex; gap: 6px; padding: 6px 10px; border-radius: 4px;
      color: var(--chiron-fg-secondary); text-decoration: none;
      font-size: 0.875rem; line-height: 1.35;
    }
    .side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
    .side .toc-chapter-link { font-weight: 600; color: var(--chiron-fg); }
    .side .toc-num { font-family: 'JetBrains Mono', monospace; color: var(--packt-orange); font-size: 0.78rem; flex-shrink: 0; font-weight: 600; }
    .side ul.toc-sub { list-style: none; padding: 0 0 0 1.5rem; margin: 0.15rem 0 0.5rem; border-left: 2px solid var(--chiron-divider); }
    .side .toc-sub-link {
      display: block; font-size: 0.8rem; color: var(--chiron-fg-secondary);
      padding: 5px 10px; font-weight: 500; border-left: 3px solid transparent;
      margin-left: -2px; transition: all 0.15s ease;
    }
    .side .toc-sub-link:hover { color: var(--packt-orange); background: var(--chiron-elevated); }
    /* Scroll-spy: active sub-section link */
    .side .toc-sub-link.is-active {
      color: var(--packt-orange); font-weight: 700;
      border-left-color: var(--packt-orange);
      background: var(--packt-orange-soft);
    }
    .side .toc-chapter-link.is-active-chapter { color: var(--packt-orange); }
    .side .toc-chapter-link.is-active-chapter .toc-title { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--packt-orange); }

    /* ── Main reading pane ── */
    main.main { overflow-y: auto; height: 100vh; position: relative; scroll-behavior: smooth; }
    section.chapter {
      max-width: 860px; margin: 0 auto; padding: 1.5rem 3rem 5rem;
      position: relative;
    }
    .breadcrumbs {
      font-size: 0.78rem; color: var(--chiron-fg-secondary);
      padding: 0.5rem 0 0.75rem; border-bottom: 1px solid var(--chiron-divider);
      margin-bottom: 1.5rem;
    }
    .breadcrumbs .bc-link { color: var(--chiron-fg-secondary); text-decoration: none; }
    .breadcrumbs .bc-link:hover { color: var(--packt-orange); }
    .breadcrumbs .bc-sep { margin: 0 8px; color: var(--chiron-divider); }
    .breadcrumbs .bc-current { color: var(--chiron-fg); font-weight: 600; }

    section.chapter > .ch-num {
      font-family: 'JetBrains Mono', monospace;
      text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--packt-orange); font-size: 0.72rem; font-weight: 600;
    }
    section.chapter > h1 {
      font-family: 'Lato', sans-serif; font-weight: 700;
      font-size: 2rem; line-height: 1.2;
      margin: 0.3rem 0 1.5rem; color: var(--chiron-fg);
    }
    section.chapter h2 {
      font-family: 'Lato', sans-serif; font-weight: 700;
      font-size: 1.55rem; line-height: 1.25;
      margin: 2.5rem 0 1rem;
      color: var(--chiron-fg);
      padding: 0.35rem 0 0.5rem 0.85rem;
      border-left: 5px solid var(--packt-orange);
      background: linear-gradient(to right, var(--chiron-elevated) 0, transparent 80%);
      border-radius: 0 4px 4px 0;
      scroll-margin-top: 1rem;
    }
    section.chapter h2::before {
      content: '§ '; color: var(--packt-orange); font-weight: 800; opacity: 0.7;
      font-family: 'JetBrains Mono', monospace; font-size: 0.85em;
    }
    section.chapter h3 { font-family: 'Lato', sans-serif; font-weight: 600; font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: var(--chiron-fg); }
    section.chapter p { margin: 0.85rem 0; }
    section.chapter ol, section.chapter ul { margin: 0.5rem 0; padding-left: 1.5rem; }
    section.chapter li { margin: 0.4rem 0; }
    section.chapter code { background: var(--chiron-elevated); color: var(--packt-orange); padding: 1px 6px; border-radius: 3px; font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 0.88em; }

    /* ── Learning objectives block (Packt's "By the end of this chapter…") ── */
    .learning-objectives {
      background: var(--chiron-elevated); border-radius: 6px;
      padding: 1rem 1.5rem; margin: 1.25rem 0;
    }
    .learning-objectives .objectives-header {
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 0.95rem;
      color: var(--chiron-fg); margin-bottom: 0.5rem;
    }
    .learning-objectives ul { margin: 0.25rem 0 0; padding-left: 1.5rem; }
    .learning-objectives li { margin: 0.3rem 0; font-size: 0.95rem; }

    /* ── Technical Requirements ── */
    aside.tech-req {
      background: var(--chiron-surface); border: 1px solid var(--chiron-border);
      border-radius: 6px; padding: 0.9rem 1.25rem; margin: 1rem 0 1.5rem;
    }
    aside.tech-req .tech-req-header {
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 0.85rem;
      color: var(--chiron-fg-secondary); text-transform: uppercase;
      letter-spacing: 0.1em; margin-bottom: 0.4rem;
    }
    aside.tech-req ul { margin: 0.25rem 0 0; padding-left: 1.25rem; }
    aside.tech-req li { font-size: 0.88rem; margin: 0.25rem 0; color: var(--chiron-fg-secondary); }
    aside.tech-req code { font-size: 0.85em; }

    /* ── Packt admonition system ── */
    .admonition {
      margin: 1.25rem 0; padding: 0; border-left: 4px solid; border-radius: 0 4px 4px 0;
      overflow: hidden;
    }
    .admonition-title {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.55rem 1rem; font-family: 'Lato', sans-serif;
      font-weight: 700; font-size: 0.85rem;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .admonition-icon { font-size: 1rem; }
    .admonition-body { padding: 0.5rem 1rem 0.9rem; font-size: 0.94rem; }
    .admonition-body p:first-child { margin-top: 0; }
    .admonition-body p:last-child { margin-bottom: 0; }
    .admonition-note          { border-left-color: var(--packt-blue);   background: var(--packt-blue-soft); }
    .admonition-note .admonition-title          { color: var(--packt-blue); }
    .admonition-note .admonition-body           { color: #103a5c; }
    .admonition-tip           { border-left-color: var(--packt-green);  background: var(--packt-green-soft); }
    .admonition-tip .admonition-title           { color: var(--packt-green); }
    .admonition-tip .admonition-body            { color: #14532d; }
    .admonition-warning       { border-left-color: var(--packt-orange); background: var(--packt-orange-soft); }
    .admonition-warning .admonition-title       { color: var(--packt-orange); }
    .admonition-warning .admonition-body        { color: #7c2d12; }
    .admonition-best-practice { border-left-color: #6F42C1;             background: #F4ECFB; }
    .admonition-best-practice .admonition-title { color: #6F42C1; }
    .admonition-best-practice .admonition-body  { color: #3b1f63; }
    .admonition-hands-on      { border-left-color: #495057;             background: var(--packt-gray-soft); }
    .admonition-hands-on .admonition-title      { color: #212529; }
    .admonition-hands-on .admonition-body       { color: #212529; }

    /* ── Math callout ── */
    .math-callout {
      background: var(--chiron-elevated); border-left: 3px solid var(--packt-orange);
      border-radius: 0 4px 4px 0; padding: 0.85rem 1.25rem; margin: 1rem 0; font-size: 1.05rem;
    }
    .math-callout .math-cite {
      font-size: 0.78rem; color: var(--chiron-fg-secondary); font-style: italic;
      margin-top: 0.4rem; font-family: 'JetBrains Mono', monospace;
    }

    /* ── Tables (Packt scheme-table) ── */
    table.scheme-table {
      width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem;
    }
    table.scheme-table th {
      background: var(--chiron-elevated); color: var(--chiron-fg);
      padding: 8px 12px; text-align: left; font-weight: 700;
      font-family: 'Lato', sans-serif;
      font-size: 0.82rem; letter-spacing: 0.04em;
      border-bottom: 2px solid var(--packt-orange);
    }
    table.scheme-table td {
      padding: 9px 12px; border-bottom: 1px solid var(--chiron-divider);
      vertical-align: top;
    }
    table.scheme-table tr:nth-child(even) td { background: var(--chiron-surface); }
    table.scheme-table.cheat-sheet th { background: var(--packt-orange); color: rgb(255,255,255); border-bottom-color: var(--packt-orange); }

    /* ── ASCII diagram (technical monospace block) ── */
    section.chapter pre.ascii-diagram {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      font-size: 0.82rem; line-height: 1.5;
      color: var(--chiron-fg);
      background: var(--chiron-surface);
      border: 1px solid var(--chiron-border);
      border-left: 3px solid var(--packt-orange);
      border-radius: 4px;
      padding: 0.85rem 1.25rem; overflow-x: auto; white-space: pre;
      margin: 1rem 0;
    }

    /* ── Code block (Packt-style dark IDE) ── */
    pre.code-block {
      background: var(--packt-code-bg); color: var(--packt-code-fg);
      border-radius: 6px; padding: 0; margin: 1rem 0; overflow-x: auto;
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      font-size: 0.82rem; line-height: 1.55;
      position: relative;
    }
    pre.code-block .code-lang {
      display: block; background: rgba(0,0,0,0.3); color: rgb(171, 178, 191);
      padding: 4px 12px; font-size: 0.7rem; letter-spacing: 0.08em;
      text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    pre.code-block code { display: block; padding: 0.85rem 1.25rem; background: none; color: var(--packt-code-fg); font-size: inherit; border-radius: 0; }
    pre.code-block .cm-kw      { color: var(--packt-code-kw); }
    pre.code-block .cm-string  { color: var(--packt-code-string); }
    pre.code-block .cm-comment { color: var(--packt-code-comment); font-style: italic; }
    pre.code-block .cm-num     { color: var(--packt-code-num); }

    /* ── Failure-modes (concept-domain block, kept from prior) ── */
    .failure-modes { display: grid; gap: 0.5rem; margin: 1rem 0; }
    .failure-modes .fm {
      display: grid; grid-template-columns: 42px 1fr; gap: 0.75rem;
      padding: 0.65rem 1rem; background: var(--chiron-surface);
      border-left: 3px solid var(--packt-orange); border-radius: 0 4px 4px 0;
      font-size: 0.93rem;
    }
    .failure-modes .fm-num { font-family: 'JetBrains Mono', monospace; color: var(--packt-orange); font-weight: 700; }
    .failure-modes .fm-body { line-height: 1.6; }

    /* ── Protocol (numbered ordered list with badges) ── */
    ol.protocol { counter-reset: protocol; list-style: none; padding-left: 0; }
    ol.protocol li {
      counter-increment: protocol; padding-left: 2.5rem; position: relative;
      margin-bottom: 0.5rem;
    }
    ol.protocol li::before {
      content: counter(protocol);
      position: absolute; left: 0; top: 0;
      width: 1.75rem; height: 1.75rem;
      background: var(--packt-orange); color: rgb(255,255,255);
      font-family: 'JetBrains Mono', monospace; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      border-radius: 4px; font-size: 0.85rem;
    }

    /* ── 5 rules ── */
    ul.rules { list-style: none; padding-left: 0; }
    ul.rules li {
      padding: 0.55rem 0.85rem; border-left: 3px solid var(--packt-green);
      margin-bottom: 0.45rem; background: var(--chiron-surface);
      border-radius: 0 4px 4px 0; font-size: 0.95rem;
    }

    /* ── SVG flowchart (real boxes + arrows) ── */
    figure.flowchart {
      margin: 1.25rem 0; padding: 1rem 1rem 0.85rem; background: var(--chiron-surface);
      border: 1px solid var(--chiron-border); border-left: 3px solid var(--packt-orange);
      border-radius: 6px;
    }
    figure.flowchart figcaption {
      font-family: 'Lato', sans-serif; font-weight: 700; color: var(--chiron-fg);
      margin-bottom: 0.5rem; font-size: 0.95rem;
    }
    figure.flowchart svg { display: block; width: 100%; height: auto; }

    /* ── Comparison cards (worked-example pair) ── */
    .cmp-block { margin: 1.25rem 0; }
    .cmp-title {
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 0.95rem;
      color: var(--chiron-fg-secondary); margin-bottom: 0.5rem;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .cmp-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 0.75rem;
    }
    .cmp-card {
      position: relative; padding: 0.85rem 1rem 1rem;
      background: var(--chiron-surface); border: 1px solid var(--chiron-border);
      border-radius: 6px;
    }
    .cmp-card-label {
      font-family: 'Lato', sans-serif; font-weight: 600; font-size: 0.88rem;
      color: var(--chiron-fg-secondary); margin-bottom: 0.4rem;
    }
    .cmp-card-formula {
      font-family: 'JetBrains Mono', monospace; font-size: 0.92rem;
      color: var(--chiron-fg); padding: 0.4rem 0.6rem; background: var(--chiron-elevated);
      border-radius: 4px; margin-bottom: 0.5rem;
    }
    .cmp-card-result {
      font-family: 'Lato', sans-serif; font-weight: 700; font-size: 1.1rem;
      color: var(--chiron-fg);
    }
    .cmp-card-badge {
      position: absolute; top: -8px; right: 12px;
      padding: 2px 8px; border-radius: 3px;
      font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;
      font-weight: 700; letter-spacing: 0.08em;
    }
    .cmp-card--winner { border-color: var(--packt-green); border-width: 2px; }
    .cmp-card--winner .cmp-card-badge { background: var(--packt-green); color: rgb(255,255,255); }
    .cmp-card--winner .cmp-card-result { color: var(--packt-green); }
    .cmp-card--loser  { border-color: var(--chiron-border); opacity: 0.75; }
    .cmp-card--loser .cmp-card-badge  { background: var(--chiron-fg-secondary); color: rgb(255,255,255); }
    .cmp-card--warn   { border-color: var(--packt-orange); border-width: 2px; }
    .cmp-card--warn .cmp-card-badge   { background: var(--packt-orange); color: rgb(255,255,255); }
    .cmp-takeaway {
      margin-top: 0.75rem; padding: 0.65rem 0.9rem;
      background: var(--packt-orange-soft); border-left: 3px solid var(--packt-orange);
      border-radius: 0 4px 4px 0; font-size: 0.95rem; color: #7c2d12;
    }

    /* ── Chart SVG ── */
    figure.chart-svg {
      margin: 1rem 0; padding: 0.85rem 1rem; background: var(--chiron-surface);
      border: 1px solid var(--chiron-border); border-radius: 6px;
    }
    figure.chart-svg figcaption {
      font-family: 'Lato', sans-serif; font-weight: 600; color: var(--chiron-fg);
      margin-bottom: 0.4rem; font-size: 0.92rem;
    }
    figure.chart-svg svg { display: block; width: 100%; height: auto; max-height: 280px; }
    figure.chart-svg .legend {
      display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.4rem;
      font-family: 'JetBrains Mono', monospace; font-size: 0.74rem;
      color: var(--chiron-fg-secondary);
    }
    figure.chart-svg .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    figure.chart-svg .legend-swatch { width: 10px; height: 10px; border-radius: 2px; }

    /* ── Chapter Summary ── */
    .chapter-summary {
      margin: 2.5rem 0 0; padding: 1.25rem 1.5rem;
      background: var(--chiron-elevated);
      border-top: 3px solid var(--packt-orange);
      border-radius: 0 0 6px 6px;
    }
    .chapter-summary h2 {
      margin: 0 0 0.5rem; font-family: 'Lato', sans-serif; font-weight: 700;
      font-size: 1.25rem; color: var(--chiron-fg);
      border-bottom: none; padding-bottom: 0;
    }
    .chapter-summary p { margin: 0.4rem 0; font-size: 0.92rem; color: var(--chiron-fg-secondary); }
    .chapter-summary ul { margin: 0.4rem 0 0; padding-left: 1.5rem; }
    .chapter-summary li { margin: 0.3rem 0; font-size: 0.94rem; }

    /* ── Source citation ── */
    .source-cite {
      font-size: 0.78rem; color: var(--chiron-fg-secondary);
      font-family: 'JetBrains Mono', monospace;
      padding: 0.5rem 0; border-top: 1px dashed var(--chiron-divider);
      margin-top: 1.5rem;
    }

    /* ── Theme picker pinned at sidebar bottom ── */
    .theme-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px dashed var(--chiron-divider); }
    .theme-bar button {
      font: inherit; font-size: 10px; padding: 3px 7px; border-radius: 3px;
      background: var(--chiron-elevated); color: var(--chiron-fg-secondary);
      border: 1px solid var(--chiron-border); cursor: pointer;
    }
    .theme-bar button[aria-pressed="true"] { background: var(--packt-orange); color: rgb(255,255,255); border-color: var(--packt-orange); }

    @media (max-width: 880px) {
      body { grid-template-columns: 1fr; }
      aside.side { position: relative; height: auto; }
      section.chapter { padding: 1rem 1.25rem 4rem; }
    }
  </style>
</head>
<body>
  <aside class="side">
    <div class="brand">CHIRON · CIVICS</div>
    <div class="brand-sub">How a bill becomes a law<br><span style="color:var(--packt-orange);font-weight:600">concepts domain</span> · Packt-style</div>

    <div class="toc-header">Contents</div>
    <ul class="toc-root">${sidebarToc}</ul>

    <div class="theme-bar" role="group" aria-label="Theme">
      <button data-theme-set="warm-paper" aria-pressed="true">Light</button>
      <button data-theme-set="midnight" aria-pressed="false">Dark</button>
      <button data-theme-set="ocean" aria-pressed="false">Ocean</button>
    </div>
  </aside>
  <main class="main">
${chaptersHtml}
  </main>

  <script>
    // Theme picker
    (function () {
      const validThemes = ['clinical','midnight','warm-paper','linguistic','ocean'];
      const params = new URLSearchParams(location.search);
      const tUrl = params.get('theme');
      const tStored = localStorage.getItem('chiron-theme');
      const theme = validThemes.includes(tUrl) ? tUrl : (validThemes.includes(tStored) ? tStored : 'warm-paper');
      document.documentElement.setAttribute('data-theme', theme);
      document.querySelectorAll('.theme-bar button[data-theme-set]').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.themeSet === theme ? 'true' : 'false');
        b.addEventListener('click', () => {
          document.documentElement.setAttribute('data-theme', b.dataset.themeSet);
          localStorage.setItem('chiron-theme', b.dataset.themeSet);
          document.querySelectorAll('.theme-bar button[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        });
      });
    })();

    // Scroll-spy via IntersectionObserver — single-source-of-truth, no flicker
    (function () {
      const main = document.querySelector('main.main');
      if (!main) return;
      const subLinks = Array.from(document.querySelectorAll('.toc-sub-link'));
      const chapterLinks = Array.from(document.querySelectorAll('.toc-chapter-link'));

      // Build link maps keyed by target id
      const subByHash = new Map();
      subLinks.forEach(l => {
        const href = (l.getAttribute('href') || '').replace(/^#/, '');
        if (href) subByHash.set(href, l);
      });
      const chapterByHash = new Map();
      chapterLinks.forEach(l => {
        const href = (l.getAttribute('href') || '').replace(/^#/, '');
        if (href) chapterByHash.set(href, l);
      });

      // Targets that actually exist in the document
      const subTargets = Array.from(subByHash.keys()).map(id => document.getElementById(id)).filter(Boolean);
      const chapterTargets = Array.from(chapterByHash.keys()).map(id => document.getElementById(id)).filter(Boolean);

      // Track currently-intersecting elements; pick the topmost one
      const visibleSubs = new Set();
      const visibleChapters = new Set();

      function refreshActive() {
        // Sub-section: pick the visible target with the smallest top distance from container top
        const containerRect = main.getBoundingClientRect();
        function pickTop(set) {
          let best = null, bestDist = Infinity;
          for (const el of set) {
            const r = el.getBoundingClientRect();
            const dist = Math.abs(r.top - containerRect.top - 40);
            if (dist < bestDist) { bestDist = dist; best = el; }
          }
          return best;
        }
        const topSub = pickTop(visibleSubs) || subTargets[0];
        const topCh  = pickTop(visibleChapters) || chapterTargets[0];

        subLinks.forEach(l => l.classList.remove('is-active'));
        chapterLinks.forEach(l => l.classList.remove('is-active-chapter'));
        if (topSub && subByHash.has(topSub.id)) {
          const link = subByHash.get(topSub.id);
          link.classList.add('is-active');
          // Auto-scroll sidebar so active link stays in view
          const aside = document.querySelector('aside.side');
          if (aside) {
            const linkRect = link.getBoundingClientRect();
            const asideRect = aside.getBoundingClientRect();
            if (linkRect.top < asideRect.top + 40 || linkRect.bottom > asideRect.bottom - 40) {
              link.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }
        }
        if (topCh && chapterByHash.has(topCh.id)) {
          chapterByHash.get(topCh.id).classList.add('is-active-chapter');
        }
      }

      const subObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => en.isIntersecting ? visibleSubs.add(en.target) : visibleSubs.delete(en.target));
        refreshActive();
      }, { root: main, rootMargin: '-10% 0px -70% 0px', threshold: 0 });
      subTargets.forEach(el => subObserver.observe(el));

      const chObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => en.isIntersecting ? visibleChapters.add(en.target) : visibleChapters.delete(en.target));
        refreshActive();
      }, { root: main, rootMargin: '-10% 0px -60% 0px', threshold: 0 });
      chapterTargets.forEach(el => chObserver.observe(el));

      refreshActive();
    })();

    // Click handler — scrolls the MAIN container (NOT window), works around the
    // nested scroll container so anchor clicks actually move the page.
    document.querySelectorAll('.toc-link').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href || !href.startsWith('#')) return;
        const targetId = href.slice(1);
        const target = document.getElementById(targetId);
        const main = document.querySelector('main.main');
        if (!target || !main) {
          console.warn('[chiron] toc click — target not found:', targetId);
          return;
        }
        e.preventDefault();
        // Compute target's offset relative to the scrolling container
        const targetTop = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
        main.scrollTo({ top: targetTop - 20, behavior: 'smooth' });
        history.replaceState(null, '', href);
      });
    });
  </script>
</body>
</html>`;

writeFileSync(resolve(LESSON_DIR, 'lesson.html'), html);
console.log('✓ wrote', resolve(LESSON_DIR, 'lesson.html'));
console.log('  size:', html.length, 'bytes');
console.log('  chapters:', chapters.length, '(concepts-shape, Packt-styled)');
