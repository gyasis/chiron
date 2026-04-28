/*
 * Chiron forest-plot — minimal vanilla SVG forest plot for meta-analysis widgets.
 *
 * Usage:
 *   import { renderForestPlot } from './forest-plot.js';
 *   renderForestPlot(containerEl, {
 *     studies: [
 *       { label: 'Smith 2018', effect: 0.82, ci: [0.65, 1.04] },
 *       { label: 'Jones 2020', effect: 0.71, ci: [0.55, 0.92] },
 *     ],
 *     summary: { effect: 0.77, ci: [0.68, 0.87] },  // optional diamond
 *     title: 'Drug X vs placebo',                   // optional
 *     effectLabel: 'Risk Ratio',                    // x-axis label
 *     nullLine: 1,                                  // x-value of "no effect" line; default 1
 *     logScale: false                               // log-x for ratios; default false
 *   });
 *
 * No external dependencies. ~250 LOC. Honors --chiron-* CSS vars.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Render a forest plot into `container`.
 * Returns the created <svg> element.
 */
export function renderForestPlot(container, opts) {
  if (!container) throw new Error('renderForestPlot: container is required');
  const studies = Array.isArray(opts?.studies) ? opts.studies : [];
  if (studies.length === 0) {
    throw new Error('renderForestPlot: at least one study required');
  }
  const summary = opts.summary ?? null;
  const title = opts.title ?? '';
  const effectLabel = opts.effectLabel ?? 'Effect';
  const nullLine = typeof opts.nullLine === 'number' ? opts.nullLine : 1;
  const logScale = !!opts.logScale;

  // Layout
  const labelColW = 180;
  const ciColW = 140;
  const plotColW = 360;
  const rowH = 28;
  const headerH = 36;
  const titleH = title ? 28 : 0;
  const summaryH = summary ? rowH + 8 : 0;
  const axisH = 36;
  const padding = { t: 12, r: 16, b: 16, l: 16 };

  const width = padding.l + labelColW + plotColW + ciColW + padding.r;
  const height = padding.t + titleH + headerH + studies.length * rowH + summaryH + axisH + padding.b;

  // Compute x-domain
  const allValues = [];
  for (const s of studies) {
    allValues.push(s.ci[0], s.ci[1], s.effect);
  }
  if (summary) allValues.push(summary.ci[0], summary.ci[1], summary.effect);
  allValues.push(nullLine);
  let xMin = Math.min(...allValues);
  let xMax = Math.max(...allValues);
  // Pad domain by 5%
  const span = xMax - xMin || 1;
  xMin -= span * 0.05;
  xMax += span * 0.05;

  const plotX0 = padding.l + labelColW;
  const plotX1 = plotX0 + plotColW;

  function xScale(v) {
    if (logScale) {
      const lv = Math.log(Math.max(v, 1e-9));
      const lmin = Math.log(Math.max(xMin, 1e-9));
      const lmax = Math.log(Math.max(xMax, 1e-9));
      return plotX0 + ((lv - lmin) / (lmax - lmin)) * plotColW;
    }
    return plotX0 + ((v - xMin) / (xMax - xMin)) * plotColW;
  }

  // Create SVG
  clearChildren(container);
  const svg = el('svg', {
    xmlns: SVG_NS,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    class: 'chiron-forest-plot',
    role: 'img',
    'aria-label': title || 'Forest plot',
  });
  container.appendChild(svg);

  let y = padding.t;

  // Title
  if (title) {
    el('text', {
      x: padding.l,
      y: y + 18,
      class: 'fp-title',
      'font-size': 16,
      'font-weight': 700,
    }, svg).textContent = title;
    y += titleH;
  }

  // Header row
  el('text', { x: padding.l, y: y + 22, class: 'fp-header', 'font-weight': 600 }, svg)
    .textContent = 'Study';
  el('text', {
    x: plotX1 + 8, y: y + 22, class: 'fp-header', 'font-weight': 600,
  }, svg).textContent = `${effectLabel} (95% CI)`;

  // Center plot label
  el('text', {
    x: (plotX0 + plotX1) / 2,
    y: y + 22,
    class: 'fp-header',
    'font-weight': 600,
    'text-anchor': 'middle',
  }, svg).textContent = effectLabel;

  y += headerH;

  // Null line (vertical reference)
  const nullX = xScale(nullLine);
  const studiesTop = y;
  const studiesBottom = y + studies.length * rowH + summaryH;
  el('line', {
    x1: nullX, x2: nullX,
    y1: studiesTop - 4, y2: studiesBottom + 4,
    class: 'fp-null-line',
    'stroke-dasharray': '4 3',
  }, svg);

  // Study rows
  studies.forEach((s, i) => {
    const rowY = y + i * rowH + rowH / 2;

    // Label
    el('text', {
      x: padding.l, y: rowY + 4, class: 'fp-label',
    }, svg).textContent = s.label;

    // CI line
    el('line', {
      x1: xScale(s.ci[0]),
      x2: xScale(s.ci[1]),
      y1: rowY,
      y2: rowY,
      class: 'fp-ci',
      'stroke-width': 1.5,
    }, svg);

    // Effect dot
    el('circle', {
      cx: xScale(s.effect),
      cy: rowY,
      r: 5,
      class: 'fp-effect-dot',
    }, svg);

    // Numeric label on the right
    const ciStr = `${s.effect.toFixed(2)} (${s.ci[0].toFixed(2)}, ${s.ci[1].toFixed(2)})`;
    el('text', {
      x: plotX1 + 8, y: rowY + 4, class: 'fp-numeric',
    }, svg).textContent = ciStr;
  });

  // Summary diamond
  if (summary) {
    const dy = y + studies.length * rowH + 8 + rowH / 2;
    const cx = xScale(summary.effect);
    const xL = xScale(summary.ci[0]);
    const xR = xScale(summary.ci[1]);
    const halfH = 8;
    const diamond = `${xL},${dy} ${cx},${dy - halfH} ${xR},${dy} ${cx},${dy + halfH}`;
    el('polygon', { points: diamond, class: 'fp-summary' }, svg);

    el('text', {
      x: padding.l, y: dy + 4, class: 'fp-label fp-summary-label', 'font-weight': 600,
    }, svg).textContent = 'Overall';

    const sumStr = `${summary.effect.toFixed(2)} (${summary.ci[0].toFixed(2)}, ${summary.ci[1].toFixed(2)})`;
    el('text', {
      x: plotX1 + 8, y: dy + 4, class: 'fp-numeric', 'font-weight': 600,
    }, svg).textContent = sumStr;
  }

  // X-axis
  const axisY = y + studies.length * rowH + summaryH + 12;
  el('line', {
    x1: plotX0, x2: plotX1,
    y1: axisY, y2: axisY,
    class: 'fp-axis',
  }, svg);

  // Tick marks (5 ticks across the domain)
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const t = xMin + ((xMax - xMin) * i) / ticks;
    const tx = xScale(t);
    el('line', {
      x1: tx, x2: tx, y1: axisY, y2: axisY + 4, class: 'fp-axis',
    }, svg);
    el('text', {
      x: tx, y: axisY + 16,
      class: 'fp-tick', 'text-anchor': 'middle', 'font-size': 11,
    }, svg).textContent = t.toFixed(2);
  }

  return svg;
}

export default { renderForestPlot };
