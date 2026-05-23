#!/usr/bin/env node
/**
 * Quant Trading — concepts-domain test lesson.
 *
 * Validates end-to-end: schema accepts concepts domain, renderer produces
 * v1-shaped HTML, hyper-pedagogy pattern (primary widget + companion
 * explainer in same chapter) actually composes.
 *
 * Build: every widget here goes through WidgetSchema.parse + renderWidget()
 * — no hand-painted markup. If chiron's pipeline ran today and produced
 * a syllabus with these widget specs, this script's HTML is what would
 * land on disk.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WidgetSchema } from '../dist/lib/schemas/widget-spec.js';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', 'lessons', 'quant-trading-2026-05-23');

// Render guard — parses through schema, then renders.
function R(spec) {
  const p = WidgetSchema.safeParse(spec);
  if (!p.success) {
    console.error('SCHEMA FAIL', spec.type, p.error.issues);
    process.exit(1);
  }
  return renderWidget(p.data);
}

// ─── synthetic data (one-line generators so the file stays scannable) ───
const days = Array.from({ length: 60 }, (_, i) => i + 1);
const seedRng = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
const rng = seedRng(42);
// Random walk price for SPY-ish
let price = 480;
const spyPrices = days.map(() => { price += (rng() - 0.48) * 4; return +price.toFixed(2); });
const spyMA20 = days.map((d, i) => {
  const w = spyPrices.slice(Math.max(0, i - 19), i + 1);
  return +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2);
});
// Mean-reverting series for pairs trade
let spread = 0;
const spreadSeries = days.map(() => { spread = spread * 0.85 + (rng() - 0.5) * 1.2; return +spread.toFixed(3); });
// Rolling Sharpe (mock)
const rollingSharpe = days.map((d) => +(0.4 + Math.sin(d / 7) * 0.3 + (rng() - 0.5) * 0.1).toFixed(3));
// Strategy comparison
const strategySharpes = [
  { name: 'Buy &amp; hold', sharpe: 0.62 },
  { name: 'Mean reversion', sharpe: 1.14 },
  { name: 'Momentum', sharpe: 0.87 },
  { name: '60/40 (control)', sharpe: 0.41 },
];
// BTC candlesticks
const btcCandles = Array.from({ length: 20 }, (_, i) => {
  const open = 60000 + Math.sin(i / 2) * 2000 + rng() * 800;
  const close = open + (rng() - 0.5) * 1500;
  const high = Math.max(open, close) + rng() * 500;
  const low = Math.min(open, close) - rng() * 500;
  return { x: i + 1, y: close, ohlc: { open: +open.toFixed(0), high: +high.toFixed(0), low: +low.toFixed(0), close: +close.toFixed(0) } };
});

// ─── widget specs ───
const heroWhyCare = {
  type: 'why-care-callout', id: 'hero-whycare',
  body: "Quant trading is where naive intuition gets the most expensive lessons. The math is the safety net — once you can read it, you stop trusting screenshots and start trusting backtests.",
};

const heroGlossary = {
  type: 'glossary-tooltips', id: 'hero-glossary',
  entries: [
    { term: 'alpha',  definition: 'Excess return above a benchmark — the portion of return NOT explained by market exposure.' },
    { term: 'beta',   definition: 'Sensitivity of a position to the market — beta=1 moves with the market 1:1.' },
    { term: 'sharpe', definition: 'Risk-adjusted return: (return - risk-free rate) / standard deviation of returns. Higher is better; >1 is professional, >2 is rare.' },
    { term: 'mean reversion', definition: 'The tendency of a series to drift back toward its mean. Strategies bet on snap-back after extreme moves.' },
  ],
};

// CHAPTER 2 — time series basics
const ch2Chart = {
  type: 'chart-xy', id: 'spy-price', variant: 'line',
  title: 'SPY · 60 trading days · price + 20-day moving average',
  xLabel: 'day', yLabel: 'USD',
  series: [
    { label: 'price', color: 'var(--color-accent)', points: spyPrices.map((y, i) => ({ x: days[i], y })) },
    { label: '20-day MA', color: 'var(--color-info)', points: spyMA20.map((y, i) => ({ x: days[i], y })) },
  ],
  annotations: [
    { x: 30, y: spyPrices[29], text: 'mid-window' },
  ],
};

const ch2StepCards = {
  type: 'step-cards', id: 'ts-anatomy',
  title: 'Anatomy of a time series',
  steps: [
    { n: 1, label: 'Trend',       body: 'Long-run direction. Up, down, sideways. Linear regression of price vs time gives slope.' },
    { n: 2, label: 'Seasonality', body: 'Periodic component — day-of-week, intraday hour. Removed with first differencing or detrending.' },
    { n: 3, label: 'Cycle',       body: 'Multi-month wave that isn\'t calendrical. Hard to model — usually treated as residual.' },
    { n: 4, label: 'Noise',       body: 'Everything left. Ideally i.i.d.; rarely is. Heavy tails, autocorrelation, vol clustering.' },
  ],
};

const ch2WhyCare = {
  type: 'why-care-callout', id: 'ch2-whycare',
  body: "Decomposing a price series tells you which of your edges are real (trend, mean-reversion) versus fake (noise). Skip this and you'll backtest your way into ruin.",
};

// CHAPTER 3 — mean reversion
const ch3SpreadChart = {
  type: 'chart-xy', id: 'spread', variant: 'line',
  title: 'Pairs-trade spread (AAPL − MSFT, z-score)',
  xLabel: 'day', yLabel: 'z-score',
  series: [
    { label: 'spread', color: 'var(--color-accent)', points: spreadSeries.map((y, i) => ({ x: days[i], y })) },
  ],
  annotations: [
    { x: 30, y: 2,  text: 'short the spread above +2σ' },
    { x: 30, y: -2, text: 'long below −2σ' },
  ],
};

const ch3Math = {
  type: 'mathjax', source: 'z_t = \\frac{S_t - \\mu}{\\sigma}, \\quad \\text{where } S_t = \\log(P^A_t / P^B_t)',
};

const ch3StepCards = {
  type: 'step-cards', id: 'mr-protocol',
  title: 'Mean-reversion trade lifecycle',
  steps: [
    { n: 1, label: 'Cointegrate',  body: 'Test that the pair\'s spread is stationary. Engle-Granger or Johansen.' },
    { n: 2, label: 'Z-normalise',  body: 'Standardise the spread to a z-score (rolling-window μ, σ).' },
    { n: 3, label: 'Enter',        body: 'Short the spread when z > +2; long when z < −2.' },
    { n: 4, label: 'Exit',         body: 'Close at z = 0 (target) or stop at |z| > 3.5 (regime break).' },
  ],
};

const ch3PatternCards = {
  type: 'pattern-cards', id: 'mr-failures',
  title: 'How mean reversion dies',
  cards: [
    { num: '#1', title: 'Regime change',     body: 'Pair stops cointegrating. The spread takes off and never returns.', foot: 'Symptom: stop-out at |z|>3.5 every entry' },
    { num: '#2', title: 'Crowded trade',     body: 'Everyone reads the same paper. Edge disappears as alpha gets arbitraged.', foot: 'Symptom: declining Sharpe over rolling 6mo' },
    { num: '#3', title: 'Liquidity gap',     body: 'Half-cycle into the trade, one leg can\'t be exited at marketable size.', foot: 'Symptom: slippage > expected by 3x' },
    { num: '#4', title: 'Funding shock',     body: 'Margin requirement spikes. Forced to close at maximum drawdown.', foot: 'Symptom: max DD coincides with vol spike, not pair fundamentals' },
  ],
};

// CHAPTER 4 — risk-adjusted returns
const ch4SharpeMath = {
  type: 'mathjax', source: 'SR = \\frac{E[R_p] - R_f}{\\sigma_p} \\quad \\text{or annualised: } SR_{ann} = SR_{daily}\\,\\sqrt{252}',
};

const ch4RollingChart = {
  type: 'chart-xy', id: 'rolling-sharpe', variant: 'line',
  title: 'Rolling 30-day Sharpe — strategy under live capital',
  xLabel: 'day', yLabel: 'Sharpe',
  series: [
    { label: 'rolling SR', color: 'var(--color-success)', points: rollingSharpe.map((y, i) => ({ x: days[i], y })) },
  ],
  annotations: [
    { x: 30, y: 1.0, text: 'institutional threshold' },
  ],
};

const ch4BarChart = {
  type: 'chart-xy', id: 'strategy-sharpe', variant: 'bar',
  title: 'Backtested Sharpe by strategy (2014-2024)',
  xLabel: 'strategy #', yLabel: 'Sharpe',
  series: [
    { label: 'Sharpe', color: 'var(--color-warning)', points: strategySharpes.map((s, i) => ({ x: i + 1, y: s.sharpe })) },
  ],
};

const ch4StepCards = {
  type: 'step-cards', id: 'sharpe-derivation',
  title: 'Deriving the Sharpe ratio',
  steps: [
    { n: 1, label: 'Excess return', body: 'Subtract the risk-free rate from your strategy\'s return — what did you earn over and above the safe baseline?' },
    { n: 2, label: 'Standardise',   body: 'Divide by the standard deviation of returns. Same return at half the volatility = double the Sharpe.' },
    { n: 3, label: 'Annualise',     body: 'Multiply daily Sharpe by √252. (252 trading days/year.)' },
    { n: 4, label: 'Compare',       body: 'A Sharpe >1 is professional; >2 is rare; >3 is suspicious (overfit or misspecified vol).' },
  ],
};

const ch4WhyCare = {
  type: 'why-care-callout', id: 'ch4-whycare',
  body: "Sharpe is the only number that survives across timeframes. A 30% return with 50% vol is the same Sharpe as a 6% return with 10% vol — but one will scare you out of the trade and the other won't.",
};

// CHAPTER 5 — Kelly + position sizing
const ch5KellyMath = {
  type: 'mathjax', source: 'f^* = \\frac{p \\cdot b - q}{b} = \\frac{p(b+1) - 1}{b}',
};

const ch5Toggle = {
  type: 'layer-toggle', id: 'kelly-toggle',
  caption: 'Full Kelly vs fractional Kelly',
  axes: [
    { key: '1', label: 'Full Kelly',     title: 'Full Kelly', body: 'Mathematically growth-optimal but VOLATILE. Drawdowns of 40-60% are not edge cases. Assumes your edge estimate is perfect.' },
    { key: '2', label: 'Half Kelly',     title: 'Fractional Kelly (½)', body: 'Sacrifices ~25% of growth for half the drawdown. Industry standard — accounts for parameter uncertainty.' },
  ],
  defaultShow: 'both',
};

const ch5StepCards = {
  type: 'step-cards', id: 'sizing-protocol',
  title: 'Position sizing protocol',
  steps: [
    { n: 1, label: 'Estimate edge', body: 'Win rate p, payoff ratio b. Use BACKTEST data, not a guess.' },
    { n: 2, label: 'Apply Kelly',   body: 'f* = (p·b − q) / b. Compute your "ideal" fraction of capital.' },
    { n: 3, label: 'Discount',      body: 'Multiply by 0.5 (half Kelly) or 0.25 (quarter Kelly) for safety. Edge estimates ALWAYS shrink in production.' },
    { n: 4, label: 'Cap',           body: 'Hard cap at 25% of capital per position regardless of Kelly output. Tail risk.' },
  ],
};

const ch5Quiz = {
  type: 'mcq',
  stem: 'Your backtest shows p=0.55, b=1.2 (you risk $1 to win $1.20). Full Kelly says f* ≈ 0.17. Why would a professional NOT size at 17%?',
  options: [
    { label: 'A', text: 'Full Kelly assumes p and b are known exactly; in production they shrink, and you over-size into ruin.', correct: true, explanation: 'Right — parameter uncertainty is the killer. Half-Kelly trades 25% growth for 50% drawdown reduction.' },
    { label: 'B', text: 'Full Kelly is too conservative for institutional capital.',                             correct: false, explanation: 'Backwards — Full Kelly is aggressive, not conservative. Institutions size BELOW it.' },
    { label: 'C', text: 'Kelly doesn\'t work for trading; it\'s only for gambling.',                             correct: false, explanation: 'Kelly works for any edge-with-known-payoff. Trading just adds noise to the parameter estimates.' },
    { label: 'D', text: 'Kelly requires unlimited capital.',                                                     correct: false, explanation: 'No — Kelly is a fraction of available capital. The math works at any wealth level.' },
  ],
  variants: [{ scenario: 'crypto with p=0.51' }, { scenario: 'options with p=0.32, b=3.5' }],
};

// CHAPTER 6 — risk management + BTC vol example
const ch6Candles = {
  type: 'chart-xy', id: 'btc-candles', variant: 'candlestick',
  title: 'BTC · 20-session candles',
  xLabel: 'session', yLabel: 'USD',
  series: [{ label: 'BTC', points: btcCandles }],
};

const ch6Glossary = {
  type: 'glossary-tooltips', id: 'ch6-glossary',
  entries: [
    { term: 'drawdown',      definition: 'Peak-to-trough decline of a portfolio. Max drawdown is the deepest such decline over a period.' },
    { term: 'volatility',    definition: 'Standard deviation of returns, usually annualised. Higher vol = wider range of outcomes = more position sizing discipline required.' },
    { term: 'risk budget',   definition: 'How much you\'re willing to lose per position before exiting. Set BEFORE entry, never adjusted in-trade.' },
  ],
};

const ch6FlowAnimation = {
  type: 'flow-animation', id: 'stop-protocol',
  title: 'Stop-loss protocol (live trade)',
  actors: [
    { id: 'entry',   label: 'Entry',   icon: '🎯' },
    { id: 'monitor', label: 'Monitor', icon: '👁' },
    { id: 'stop',    label: 'Stop',    icon: '⛔' },
    { id: 'target',  label: 'Target',  icon: '✅' },
  ],
  steps: [
    { label: 'Open position at entry signal. Mark stop and target levels in the order book.', highlight: 'entry' },
    { label: 'Monitor — never widen the stop. Trail the stop UP only.',                          highlight: 'monitor', packet: true, from: 'entry', to: 'monitor' },
    { label: 'Price hits stop → close immediately, no second-guessing.',                          highlight: 'stop',    packet: true, from: 'monitor', to: 'stop' },
    { label: 'OR price hits target → close, book profit, do not chase the next leg.',             highlight: 'target',  packet: true, from: 'monitor', to: 'target' },
  ],
};

// ─── chapter assembly ───
function chapter(num, title, kicker, widgets, prose) {
  return (
    `<section class="chapter" id="ch${num}">` +
    `<div class="chap-id">Chapter ${num}</div>` +
    `<h2>${title}</h2>` +
    (kicker ? `<p class="kicker-prose">${kicker}</p>` : '') +
    widgets.map(w => R(w)).join('\n') +
    (prose || '') +
    `</section>`
  );
}

const chaptersHtml = [
  chapter(
    1,
    'Why quant — and what you need to read',
    'Quant trading lives at the intersection of probability, optimisation, and discipline. Before any code or chart, you have to read math without flinching. That\'s the price of admission.',
    [heroWhyCare, heroGlossary]
  ),
  chapter(
    2,
    'Reading a price chart — the four components',
    'Every price series decomposes into the same four pieces. Spot which one you\'re trading.',
    [ch2WhyCare, ch2Chart, ch2StepCards]
  ),
  chapter(
    3,
    'Mean reversion — pairs trading',
    'When two co-moving assets diverge, the spread between them often snaps back. This is the simplest, oldest, and most-arbitraged "edge."',
    [ch3SpreadChart, ch3Math, ch3StepCards, ch3PatternCards]
  ),
  chapter(
    4,
    'Risk-adjusted return — the Sharpe ratio',
    'Returns are noise. Sharpe is signal. Learn to read it, learn to trust it more than headline returns.',
    [ch4WhyCare, ch4SharpeMath, ch4StepCards, ch4RollingChart, ch4BarChart]
  ),
  chapter(
    5,
    'Position sizing — Kelly + the half-Kelly heuristic',
    'How much to risk per trade. The math says one thing; the survival data says size smaller.',
    [ch5KellyMath, ch5StepCards, ch5Toggle, ch5Quiz]
  ),
  chapter(
    6,
    'Risk management in practice — stops and drawdown',
    'The exit is the trade. A perfect entry with a sloppy exit loses money.',
    [ch6Glossary, ch6Candles, ch6FlowAnimation]
  ),
].join('\n');

// ─── full lesson.html ───
const html = `<!doctype html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quant Trading — concepts domain · Chiron pipeline lesson</title>
<link rel="stylesheet" href="themes/_tokens.css" />
<link rel="stylesheet" href="themes/midnight.css" />
<link rel="stylesheet" href="themes/warm-paper.css" />
<link rel="stylesheet" href="themes/clinical.css" />
<link rel="stylesheet" href="themes/linguistic.css" />
<link rel="stylesheet" href="themes/ocean.css" />
<link rel="stylesheet" href="chiron-shell.css" />
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
  section.chapter{padding:36px 0; border-bottom:1px solid var(--chiron-divider);}
  section.chapter:last-of-type{border-bottom:none;}
  section.chapter .chap-id{font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--chiron-fg-secondary); margin-bottom:6px;}
  section.chapter h2{font-family:var(--chiron-font-heading); font-size:30px; line-height:1.15; margin:0 0 16px; color:var(--chiron-fg);}
  section.chapter .kicker-prose{font-style:italic; color:var(--chiron-fg-secondary); margin:0 0 18px; font-size:16px; max-width:62ch;}
  /* mathjax surrogate — until vendored MathJax wires up, render LaTeX as monospace; readable, not pretty */
  .chiron-mathjax, .chiron-math, [class^="mathjax"]{
    display:block;
    padding:14px 18px;
    background:var(--chiron-elevated);
    border-left:3px solid var(--chiron-accent);
    border-radius:0 4px 4px 0;
    font-family:'JetBrains Mono', ui-monospace, monospace;
    font-size:14px;
    line-height:1.7;
    color:var(--chiron-fg);
    margin:14px 0;
    overflow-x:auto;
  }
  /* Concepts hyper-pedagogy pair: chart + step-cards side-by-side at wide widths */
  @media (min-width: 900px){
    section.chapter .chart-xy + .step-cards{ margin-top:10px; }
  }
  footer.colophon{margin-top:48px; padding-top:18px; border-top:1px solid var(--chiron-border); color:var(--chiron-fg-secondary); font-size:12.5px; font-family:'JetBrains Mono', ui-monospace, monospace; letter-spacing:.04em;}
  :root{ --chiron-paper: white; --chiron-ink: black; }
</style>
</head>
<body>
<header class="bar">
  <div>Quant Trading <span class="pill">concepts · pipeline-built · 2026-05-23</span></div>
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
    <div class="kicker">Chiron · concepts domain · pipeline-built test lesson</div>
    <h1>Quant Trading — a primer for rigorous readers</h1>
    <p class="lede">Six chapters. Six concepts. Each one paired with a chart, a derivation, or a flow. The first chiron lesson built entirely from <code>renderWidget()</code> calls — no hand-painted HTML in the chapter bodies.</p>
  </section>

  ${chaptersHtml}

  <footer class="colophon">
    chiron · lessons/quant-trading-2026-05-23 · domain=concepts · widgets via lib/widget-renderer.ts<br>
    Built: ${new Date().toISOString()} — every widget here passed WidgetSchema.parse before render
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
console.log('  widgets rendered:', chaptersHtml.match(/data-widget|chart-xy|chat-window|flow-animation|step-cards|pattern-card|layer-toggle|glossary-block|why-care|translation-block|quiz-block|chiron-math/g)?.length ?? 0);
