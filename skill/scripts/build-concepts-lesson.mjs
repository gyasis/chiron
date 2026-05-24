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
const LESSON_DIR = resolve(REPO, 'lessons/quant-trading-2026-05-23');
const LESSON_TITLE = 'Quant Trading — A Primer for Rigorous Readers';

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
    id: 'ch1', num: 1, title: 'The four parts of every price series',
    subSections: [
      { id: 'decomposition', title: 'Decomposition' },
      { id: 'worked-example', title: 'Worked example — SPY decomposition' },
    ],
    body: `
      ${objectives([
        'Decompose any price series into <strong>trend</strong>, <strong>seasonality</strong>, <strong>cycle</strong>, and <strong>noise</strong>.',
        'Identify which component a trading strategy is exploiting.',
        'Test whether a residual is true cyclicality or fake (overfit to noise).',
      ])}
      ${technicalRequirements([
        'A Python environment with <code>pandas</code>, <code>numpy</code>, <code>statsmodels</code>.',
        'Historical OHLCV data for SPY (any source — Yahoo Finance, Polygon, or AlphaVantage).',
        'Optional: Jupyter notebook for inline plots.',
      ])}

      <p>Every price chart decomposes into the same four pieces. Knowing <em>which one</em> you're trading separates a real edge from a story you're telling yourself.</p>

      <h2 id="decomposition">Decomposition</h2>
      <table class="scheme-table">
        <thead><tr><th>Component</th><th>What it is</th><th>How to test</th><th>Tradeable?</th></tr></thead>
        <tbody>
          <tr><td><strong>Trend</strong></td><td>Long-run direction</td><td>Linear regression of price vs time; slope significance</td><td>Yes — trend-following</td></tr>
          <tr><td><strong>Seasonality</strong></td><td>Periodic (day-of-week, hour-of-day)</td><td>First differencing + ACF at known periods</td><td>Yes, but arbitraged in liquid markets</td></tr>
          <tr><td><strong>Cycle</strong></td><td>Multi-month wave, non-calendrical</td><td>Spectral analysis; usually weak signal</td><td>Sometimes — regime detection</td></tr>
          <tr><td><strong>Noise</strong></td><td>Residual; should be i.i.d.</td><td>Heavy-tailed in practice; vol clustering</td><td>Never directly</td></tr>
        </tbody>
      </table>

      ${admonition('note', '<p><strong>i.i.d.</strong> = "independent and identically distributed." A textbook assumption that financial returns rarely satisfy. Heavy tails, autocorrelation, and volatility clustering all violate i.i.d., which is why robust strategies don\'t rely on Gaussian assumptions.</p>')}

      <h2 id="worked-example">Worked example — SPY decomposition</h2>
      ${svgLineChart({
        title: 'SPY · 60 trading days · price + 20-day moving average',
        xLabel: 'day', yLabel: 'USD',
        series: [
          { label: 'price', points: spyPrice.map((y, i) => ({ x: days[i], y })) },
          { label: '20-day MA', points: spyMA20.map((y, i) => ({ x: days[i], y })) },
        ],
      })}
      <p>The 20-day MA (blue) tracks the underlying trend; price (orange) wobbles around it. Subtract the MA → you isolate the cycle + noise components. If the residual passes a Ljung-Box autocorrelation test, you've isolated tradeable cyclicality. Most of the time it doesn't.</p>

      ${admonition('hands-on', '<p>Compute your own decomposition. Load 60 days of SPY, apply <code>statsmodels.tsa.seasonal.STL</code>, and plot the four components. Compare your residual\'s autocorrelation at lag 1 to a random series. If they look the same, your residual is noise.</p>')}

      ${admonition('tip', '<p>If your backtest depends on a pattern you can\'t classify as one of the four components, you\'re overfitting to noise. The discipline is in the labelling, not the backtest.</p>')}

      ${summary([
        'Every price series = trend + seasonality + cycle + noise.',
        'Each component has a distinct statistical test.',
        'Tradeable: trend (yes), seasonality (rare in liquid markets), cycle (sometimes), noise (never).',
        'Overfit-to-noise is the #1 killer of retail strategies.',
      ])}
    `,
  },

  {
    id: 'ch2', num: 2, title: 'Mean reversion — the pairs trade',
    subSections: [
      { id: 'the-math', title: 'The math' },
      { id: 'trade-lifecycle', title: 'Trade lifecycle' },
      { id: 'live-spread', title: 'Live spread' },
      { id: 'four-ways', title: 'Four ways it dies' },
    ],
    body: `
      ${objectives([
        'Define and test for <strong>cointegration</strong> between two assets.',
        'Construct a rolling z-score from a log-spread.',
        'Apply entry / exit / stop rules for a pairs trade.',
        'Recognise the four classic ways mean-reversion strategies fail in production.',
      ])}

      <p>When two co-moving assets diverge, the <strong>spread</strong> between them tends to snap back toward its mean. Simplest, oldest, most-arbitraged edge in systematic trading.</p>

      <h2 id="the-math">The math</h2>
      <div class="math-callout">
        \\[ S_t = \\log(P^A_t / P^B_t) \\quad\\quad z_t = \\frac{S_t - \\mu}{\\sigma} \\]
        <div class="math-cite">Spread of a cointegrated pair (top); rolling z-score with window μ, σ (bottom). Typical window: 60–90 days.</div>
      </div>

      <h2 id="trade-lifecycle">Trade lifecycle</h2>
      <pre class="code-block"><span class="code-lang">PYTHON · pairs-trade pseudocode</span>
<code><span class="cm-comment"># 1. Cointegrate</span>
<span class="cm-kw">from</span> statsmodels.tsa.stattools <span class="cm-kw">import</span> coint
score, pvalue, _ = coint(prices_A, prices_B)
<span class="cm-kw">if</span> pvalue &gt; <span class="cm-num">0.05</span>: <span class="cm-kw">return</span>  <span class="cm-comment"># not cointegrated → skip</span>

<span class="cm-comment"># 2. Z-normalise</span>
spread = np.log(prices_A / prices_B)
mu, sigma = spread.rolling(<span class="cm-num">60</span>).mean(), spread.rolling(<span class="cm-num">60</span>).std()
z = (spread - mu) / sigma

<span class="cm-comment"># 3. Enter — short spread at z &gt; +2σ, long at z &lt; −2σ</span>
position = <span class="cm-num">0</span>
<span class="cm-kw">if</span> z[-<span class="cm-num">1</span>] &gt; <span class="cm-num">2</span>:  position = -<span class="cm-num">1</span>
<span class="cm-kw">elif</span> z[-<span class="cm-num">1</span>] &lt; -<span class="cm-num">2</span>: position = +<span class="cm-num">1</span>

<span class="cm-comment"># 4. Exit — target at z = 0, stop at |z| &gt; 3.5</span>
<span class="cm-kw">if</span> abs(z[-<span class="cm-num">1</span>]) &gt; <span class="cm-num">3.5</span> or sign(z[-<span class="cm-num">1</span>]) != sign(z[entry]):
    close_position()</code></pre>

      ${admonition('warning', '<p>Cointegration is <strong>necessary but not sufficient</strong>. Two assets can pass an Engle-Granger test on historical data and still decouple tomorrow. The math tells you when the relationship <em>was</em> true; it doesn\'t promise when it stops.</p>')}

      <h2 id="live-spread">Live spread</h2>
      ${svgLineChart({
        title: 'Pairs spread (AAPL − MSFT, z-score) · 60 sessions',
        xLabel: 'session', yLabel: 'z-score',
        series: [{ label: 'spread', points: spread.map((y, i) => ({ x: days[i], y })) }],
      })}
      <p>Bands at ±2σ are entry triggers; ±3.5σ is the stop. Look at sessions 15–22 — a clean short-the-spread setup. Session 38 hits +3.5σ — a stop-out.</p>

      <h2 id="four-ways">Four ways mean reversion dies</h2>
      <div class="failure-modes">
        <div class="fm"><span class="fm-num">#1</span><div class="fm-body"><strong>Regime change</strong> — pair stops cointegrating. Spread runs and doesn't return. <em>Symptom:</em> stop-out at |z|&gt;3.5σ every entry.</div></div>
        <div class="fm"><span class="fm-num">#2</span><div class="fm-body"><strong>Crowded trade</strong> — everyone reads the same paper. Edge arbitraged away. <em>Symptom:</em> declining Sharpe over rolling 6mo.</div></div>
        <div class="fm"><span class="fm-num">#3</span><div class="fm-body"><strong>Liquidity gap</strong> — one leg can't be exited at marketable size mid-cycle. <em>Symptom:</em> slippage 3× expected.</div></div>
        <div class="fm"><span class="fm-num">#4</span><div class="fm-body"><strong>Funding shock</strong> — margin spikes, forced close at max DD. <em>Symptom:</em> max DD coincides with vol spike, not pair fundamentals.</div></div>
      </div>

      ${admonition('best-practice', '<p>Re-test cointegration <strong>monthly</strong> on a rolling window. If the p-value crosses 0.05, halt new entries immediately and exit existing positions on the next mean-touch.</p>')}

      ${summary([
        'Pairs trading exploits cointegration — a stationary linear combination of two assets.',
        'Z-score normalises the spread; entry at ±2σ, exit at 0, stop at ±3.5σ.',
        'Cointegration is necessary but not sufficient — re-test monthly.',
        'Four classic failure modes: regime change, crowded trade, liquidity gap, funding shock.',
      ])}
    `,
  },

  {
    id: 'ch3', num: 3, title: 'Risk-adjusted return — the Sharpe ratio',
    subSections: [
      { id: 'formula', title: 'Formula + annualisation' },
      { id: 'reading-sharpe', title: 'Reading the Sharpe' },
      { id: 'worked-example-sharpe', title: 'Worked example' },
    ],
    body: `
      ${objectives([
        'Compute and annualise a Sharpe ratio.',
        'Interpret Sharpe across the noise / retail / professional / rare / suspicious tiers.',
        'Recognise when headline returns mislead.',
      ])}

      <p>Returns alone don't measure skill. A 30% return at 50% volatility is the <em>same</em> Sharpe as a 6% return at 10% volatility. One will scare you out of the trade; the other won't. Sharpe is the dimensionless number that survives across timeframes.</p>

      <h2 id="formula">Formula + annualisation</h2>
      <div class="math-callout">
        \\[ SR = \\frac{E[R_p] - R_f}{\\sigma_p} \\quad\\quad SR_{ann} = SR_{daily} \\cdot \\sqrt{252} \\]
        <div class="math-cite">Sharpe (top). Annualised from daily (bottom) — 252 trading days/year.</div>
      </div>

      <h2 id="reading-sharpe">Reading the Sharpe</h2>
      <table class="scheme-table">
        <thead><tr><th>Annualised Sharpe</th><th>Tier</th><th>What it means</th></tr></thead>
        <tbody>
          <tr><td>&lt; 0.5</td><td>Noise</td><td>You'd do better in a Treasury bill</td></tr>
          <tr><td>0.5 – 1.0</td><td>Retail-grade</td><td>Just beats noise</td></tr>
          <tr><td>1.0 – 2.0</td><td>Professional</td><td>Sustainable, manageable drawdowns</td></tr>
          <tr><td>2.0 – 3.0</td><td>Rare</td><td>Top-decile fund</td></tr>
          <tr><td>&gt; 3.0</td><td>Suspicious</td><td>Likely overfit, lookahead bias, or misspecified σ</td></tr>
        </tbody>
      </table>

      <h2 id="worked-example-sharpe">Worked example — two strategies, different Sharpe</h2>
      ${comparisonCards({
        items: [
          { label: 'Strategy A — low headline return', formula: 'SR = (12% − 4%) / 8%', result: 'Sharpe = 1.00', badge: 'winner' },
          { label: 'Strategy B — high headline return', formula: 'SR = (25% − 4%) / 25%', result: 'Sharpe = 0.84', badge: 'loser' },
        ],
        takeaway: 'Strategy A has the <strong>HIGHER</strong> Sharpe despite lower headline returns. This is exactly why Sharpe matters — headline returns are the trap.',
      })}

      ${admonition('warning', '<p>If your Sharpe is <strong>greater than 3</strong> and you didn\'t intentionally engineer survivorship bias, look for it anyway. Sharpe > 3 in real strategies is rare enough that it usually indicates a methodological error.</p>')}

      ${admonition('tip', '<p>Always compute the <strong>rolling 90-day Sharpe</strong> in addition to the lifetime number. A single 5-year Sharpe of 1.4 hides whether the strategy stopped working in the last quarter. Rolling Sharpe surfaces regime change.</p>')}

      ${summary([
        'Sharpe = (return − risk-free) / vol. Annualise daily by √252.',
        '>1 professional, >2 rare, >3 suspicious.',
        'Same Sharpe across scales — it\'s the only metric that survives the unit change.',
        'Always pair lifetime Sharpe with rolling 90-day to spot regime change.',
      ])}
    `,
  },

  {
    id: 'ch4', num: 4, title: 'Position sizing — Kelly and half-Kelly',
    subSections: [
      { id: 'formula-kelly', title: 'The formula' },
      { id: 'sizing-tree', title: 'Sizing decision tree' },
      { id: 'why-dangerous', title: 'Why full Kelly is dangerous' },
    ],
    body: `
      ${objectives([
        'Apply the Kelly criterion to size positions given win-rate p and payoff b.',
        'Compare full Kelly, half Kelly, and quarter Kelly on growth vs drawdown.',
        'Understand why every professional shrinks Kelly in production.',
      ])}

      <p><em>How much to risk per trade</em> is the second-biggest decision in trading (after when to exit). Kelly gives the math; fractional Kelly survives production.</p>

      <h2 id="formula-kelly">The formula</h2>
      <div class="math-callout">
        \\[ f^* = \\frac{p \\cdot b - q}{b} = \\frac{p(b+1) - 1}{b} \\quad\\quad q = 1 - p \\]
        <div class="math-cite">Growth-optimal fraction of capital. p = win probability, b = payoff ratio (risk $1 to win $b).</div>
      </div>

      <h2 id="sizing-tree">Sizing decision tree</h2>
      ${svgFlowchart({
        title: 'Kelly position-sizing decision tree',
        width: 760, height: 540,
        nodes: [
          { id: 'n1', x:  220, y:  10, w: 320, h: 56, kind: 'start',
            label: 'Estimate edge from BACKTEST', sub: '(p̂, b̂)' },
          { id: 'n2', x:  220, y: 100, w: 320, h: 56, kind: 'step',
            label: 'Compute Kelly fraction', sub: 'f* = (p̂ · b̂ − q̂) / b̂' },
          { id: 'n3', x:  220, y: 200, w: 320, h: 70, kind: 'decision',
            label: 'Confident in (p̂, b̂)?' },
          { id: 'n4', x:   30, y: 320, w: 320, h: 70, kind: 'step',
            label: 'Size at FULL Kelly', sub: 'risk = f* of capital' },
          { id: 'n5', x:  410, y: 320, w: 320, h: 70, kind: 'emphasis',
            label: 'Size at HALF Kelly (or QUARTER)', sub: 'risk = f* × 0.5  (or × 0.25)' },
          { id: 'n6', x:  220, y: 420, w: 320, h: 50, kind: 'step',
            label: 'Cap at 25% of capital', sub: 'tail-risk insurance' },
          { id: 'n7', x:  280, y: 490, w: 200, h: 40, kind: 'terminal',
            label: 'Execute' },
        ],
        edges: [
          { from: 'n1', to: 'n2' },
          { from: 'n2', to: 'n3' },
          { from: 'n3', to: 'n4', label: 'YES', kind: 'yes' },
          { from: 'n3', to: 'n5', label: 'NO',  kind: 'no' },
          { from: 'n4', to: 'n6' },
          { from: 'n5', to: 'n6' },
          { from: 'n6', to: 'n7' },
        ],
      })}

      <h2 id="why-dangerous">Why full Kelly is dangerous</h2>
      <table class="scheme-table">
        <thead><tr><th></th><th>Full Kelly</th><th>Half Kelly</th><th>Quarter Kelly</th></tr></thead>
        <tbody>
          <tr><td>Long-run growth rate</td><td>100%</td><td>~75%</td><td>~44%</td></tr>
          <tr><td>Typical max DD</td><td>40–60%</td><td>20–30%</td><td>10–15%</td></tr>
          <tr><td>Survives parameter error?</td><td>No</td><td>Yes (small)</td><td>Yes (large)</td></tr>
          <tr><td>Industry usage</td><td>Rare</td><td>Standard</td><td>Conservative</td></tr>
        </tbody>
      </table>

      ${admonition('hands-on', '<p>Compute Kelly for your last backtest. Say it yielded p = 0.55, b = 1.2 (risk $1 to win $1.20). Plug into the formula:</p><p><strong>f* = (0.55 × 1.2 − 0.45) / 1.2 = 0.175</strong></p><p>Full Kelly says size at 17.5% per trade. Half Kelly: 8.75%. Now ask yourself — at half Kelly, can you stomach a 25% drawdown? If not, drop to quarter Kelly. <strong>The maths is the upper bound. Your psychology sets the actual size.</strong></p>')}

      ${admonition('warning', '<p>Full Kelly assumes you know p and b <em>exactly</em>. In production they are <em>estimates</em> with error bars. Even a small overestimate of p compounds catastrophically. Half Kelly trades 25% of theoretical growth for 50% drawdown reduction — that\'s the cheap insurance the maths doesn\'t tell you to buy.</p>')}

      ${summary([
        'Kelly criterion gives the growth-optimal capital fraction f*.',
        'Half Kelly is industry standard — sacrifices 25% of growth for 50% drawdown reduction.',
        'Hard-cap any single position at 25% of capital regardless of Kelly.',
        'Your psychology sets the actual size — Kelly is the upper bound.',
      ])}
    `,
  },

  {
    id: 'ch5', num: 5, title: 'Risk management — stops, trailing, drawdown budgets',
    subSections: [
      { id: 'protocol', title: 'The protocol' },
      { id: 'dd-budgets', title: 'Drawdown budgets' },
      { id: 'case-stop', title: 'A case — when the stop gets argued with' },
    ],
    body: `
      ${objectives([
        'Set entry stops BEFORE the trade and never widen in-trade.',
        'Apply trailing-stop discipline (UP only, in a long).',
        'Define a per-portfolio drawdown budget and a halt-trading trigger.',
        'Recognise the discretionary-override-of-quant-rule failure mode.',
      ])}

      <p>Position sizing answers <em>how much</em>; the stop-loss protocol answers <em>when to exit when wrong</em>. The exit is where positive-expectancy strategies become flat or losing.</p>

      <h2 id="protocol">The protocol</h2>
      <ol class="protocol">
        <li><strong>Set stop level BEFORE entering.</strong> Never widen in-trade.</li>
        <li><strong>Trail stop UP only</strong> (in a long position).</li>
        <li><strong>At the stop: close immediately</strong>, no second-guessing.</li>
        <li><strong>At the target: close, book</strong>, do not chase the next leg.</li>
        <li><strong>Halt trading</strong> when portfolio drawdown exceeds budget.</li>
      </ol>

      <h2 id="dd-budgets">Drawdown budgets — by trader profile</h2>
      <table class="scheme-table">
        <thead><tr><th>Profile</th><th>Per-trade stop</th><th>Strategy DD halt</th><th>Portfolio DD halt</th></tr></thead>
        <tbody>
          <tr><td>Discretionary swing</td><td>1–2% of capital</td><td>—</td><td>10%</td></tr>
          <tr><td>Systematic single-strategy</td><td>Per backtest σ</td><td>2× backtest max DD</td><td>—</td></tr>
          <tr><td>Multi-strategy fund</td><td>Per book/strategy</td><td>Per stop-loss policy</td><td>10–15% (mandate)</td></tr>
          <tr><td>Quant retail</td><td>Per Kelly fraction</td><td>1.5× backtest max DD</td><td>20%</td></tr>
        </tbody>
      </table>

      <h2 id="case-stop">A case — when the stop gets argued with</h2>
      ${admonition('hands-on', `
        <p><strong>Setup:</strong> AAPL/MSFT pairs strategy, $100k capital, half-Kelly. Backtest Sharpe 1.4, max DD 12%.</p>
        <p><strong>Month 4:</strong> z hits +3.8σ. Rule says stop at |z|&gt;3.5. AAPL beat earnings, MSFT missed. You think: <em>"fundamentals-driven, this MUST mean-revert when MSFT recovers."</em> You hold.</p>
        <p><strong>Month 7:</strong> z at +5σ. Down 14% — past your 12% DD budget. You think: <em>"too late to stop now."</em> You hold.</p>
        <p><strong>Month 9:</strong> z settles at +6.2σ. Cointegration permanently broken (services-revenue mix vs cloud growth diverged). You close. <strong>Total loss: 22% of capital.</strong></p>
        <p><strong>Diagnosis:</strong> the single most costly decision was overriding the stop at Month 4. Every loss after that is downstream. The rule existed because backtest data said |z|&gt;3.5 historically signalled regime change. A fundamentals story is not a reason to override a quant rule — it's the classic discretionary-override failure mode.</p>
      `)}

      ${admonition('warning', '<p>If you find yourself <strong>negotiating with a position</strong> about whether to honour the stop, the stop was right and you are wrong. Close it. Document the trade in your journal. Move on.</p>')}

      ${summary([
        'Stops are pre-paid losses. Honour them mechanically.',
        'Trail UP only — never down. Widening a stop is renaming a trade as an investment.',
        'Define per-profile drawdown budgets and a portfolio halt trigger.',
        'The most expensive single mistake is overriding a quant rule with a discretionary story.',
      ])}
    `,
  },

  {
    id: 'ch6', num: 6, title: 'Cheat sheet — pick the right tool',
    subSections: [
      { id: 'strategy-matrix', title: 'Strategy ↔ situation matrix' },
      { id: 'five-rules', title: 'The five rules' },
    ],
    body: `
      ${objectives([
        'Match a market situation to the appropriate strategy family.',
        'Internalise the five non-negotiable rules of disciplined trading.',
      ])}

      <h2 id="strategy-matrix">Strategy ↔ situation matrix</h2>
      <table class="scheme-table cheat-sheet">
        <thead><tr><th>Situation</th><th>Strategy family</th><th>Key metric</th><th>Biggest risk</th></tr></thead>
        <tbody>
          <tr><td>Persistent trend + low vol</td><td>Trend-following / momentum</td><td>Sharpe + max DD ratio</td><td>Regime change (whipsaws)</td></tr>
          <tr><td>Co-moving assets diverge</td><td>Pairs / cointegration</td><td>Spread z-score</td><td>Cointegration breaks permanently</td></tr>
          <tr><td>Periodic anomaly</td><td>Seasonality / calendar</td><td>Out-of-sample Sharpe</td><td>Arbitraged away in liquid markets</td></tr>
          <tr><td>Multi-leg arbitrage</td><td>Stat arb / market making</td><td>P&amp;L per share + inventory turn</td><td>Liquidity shock; latency loss</td></tr>
          <tr><td>Convex payoff structures</td><td>Options / vol selling</td><td>Sortino, tail VaR</td><td>Vol-of-vol blow-up</td></tr>
          <tr><td>None of the above</td><td>Stay in cash</td><td>—</td><td>Boredom-driven entry</td></tr>
        </tbody>
      </table>

      <h2 id="five-rules">The five rules (memorise)</h2>
      <ul class="rules">
        <li><strong>Sharpe over returns.</strong> Headline returns lie; Sharpe normalises.</li>
        <li><strong>Half Kelly, never full.</strong> Edge estimates always shrink in production.</li>
        <li><strong>Set the stop before entering.</strong> Never widen in-trade.</li>
        <li><strong>Cointegration is necessary, not sufficient.</strong> Validate out-of-sample.</li>
        <li><strong>If you can't classify the edge as trend / season / cycle / arb, you're overfitting noise.</strong></li>
      </ul>

      ${admonition('best-practice', '<p>Print this page. Pin it above your trading desk. Re-read it on day one of every new strategy and on day one of every drawdown.</p>')}

      <p class="source-cite">References: Kelly (1956) · Sharpe (1966) · Engle-Granger (1987) · Lo (2004, The Adaptive Markets Hypothesis) · Bouchaud &amp; Potters (2003, Theory of Financial Risk)</p>
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
    <div class="brand">CHIRON · QUANT TRADING</div>
    <div class="brand-sub">A primer for rigorous readers<br><span style="color:var(--packt-orange);font-weight:600">concepts domain</span> · Packt-style</div>

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
