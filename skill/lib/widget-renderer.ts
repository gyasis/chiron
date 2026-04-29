/**
 * Chiron — Widget renderer dispatcher (T020).
 *
 * Maps `WidgetSpec.type` → render function. Wave-2 ships only the dispatcher
 * skeleton; concrete renderers are filled in by later waves:
 *   - T038, T040          (mcq, true-false, mathjax, mermaid universal)
 *   - T055-T058           (medicine: vignette, agreement-matrix, molecule, forest-plot)
 *   - T077-T079           (language: fill-blank, matching-pair, audio-tts)
 *   - T101-T102           (code: spot-the-bug, code-runner)
 *
 * Every unimplemented kind throws `NotImplemented: <kind>` so the build fails
 * loudly rather than silently emitting blank HTML — easier for later waves
 * to debug.
 *
 * Renderers are registered via `registerRenderer(kind, fn)` so later waves
 * can extend without editing this file (open/closed).
 */

import type { WidgetKind, WidgetSpec } from './schemas/widget-spec.js';
import { WIDGET_KINDS } from './schemas/widget-spec.js';

/** Narrowed shape for the spot-the-bug widget (mirrors SpotTheBugWidgetSchema). */
type SpotTheBugWidget = Extract<WidgetSpec, { type: 'spot-the-bug' }>;

/** Minimal HTML escape for code/text injected into the rendered output. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Stable per-instance id (good enough for in-page widget scoping). */
let __widgetIdCounter = 0;
function nextWidgetId(prefix: string): string {
  __widgetIdCounter += 1;
  return `${prefix}-${__widgetIdCounter}`;
}

/**
 * Renderer for `spot-the-bug` widgets.
 *
 * Emits a self-contained HTML fragment:
 *   - <pre><code> with one <span class="line"> per line, prefixed by a <span class="lineno">.
 *   - Click any line to toggle `.marked` (tracked in a per-instance Set<number>).
 *   - "Check" button compares marked lines to the spec's bug line(s); shows
 *     success or a diff (missed / false-flagged), then reveals the explanation.
 *
 * Note on contract: the widget-spec schema declares a SINGULAR `bugLine: number`
 * (1-indexed). The T038 task brief mentioned `spec.bugLines` (plural) — we
 * normalise to a single-element array internally so the renderer is forward-
 * compatible if the contract ever moves to a list, while staying faithful to
 * the current schema.
 */
export function renderSpotTheBug(spec: SpotTheBugWidget): string {
  const id = nextWidgetId('stb');
  const code = spec.codeBlock ?? '';
  const lines = code.split('\n');
  const bugLines: number[] = [spec.bugLine];

  const lineHtml = lines
    .map((raw, idx) => {
      const n = idx + 1;
      const safe = escapeHtml(raw.length === 0 ? ' ' : raw);
      return (
        `<span class="line" data-line="${n}">` +
        `<span class="lineno">${n}</span>` +
        `<span class="line-content">${safe}</span>` +
        `</span>`
      );
    })
    .join('\n');

  const bugLinesJson = JSON.stringify(bugLines);
  const explanationHtml = escapeHtml(spec.explanation ?? '');

  return [
    `<div class="spot-the-bug" id="${id}" data-widget="spot-the-bug">`,
    `  <pre class="stb-code"><code>${lineHtml}</code></pre>`,
    `  <div class="stb-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="stb-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="bug-explanation" hidden>${explanationHtml}</div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var bugLines = ${bugLinesJson};`,
    `    var marked = new Set();`,
    `    root.querySelectorAll('.line').forEach(function(el){`,
    `      el.addEventListener('click', function(){`,
    `        var n = parseInt(el.getAttribute('data-line'), 10);`,
    `        if (marked.has(n)) { marked.delete(n); el.classList.remove('marked'); }`,
    `        else { marked.add(n); el.classList.add('marked'); }`,
    `      });`,
    `    });`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    var feedback = root.querySelector('.stb-feedback');`,
    `    var explanation = root.querySelector('.bug-explanation');`,
    `    btn.addEventListener('click', function(){`,
    `      var bugSet = new Set(bugLines);`,
    `      var missed = bugLines.filter(function(n){ return !marked.has(n); });`,
    `      var falseFlags = Array.from(marked).filter(function(n){ return !bugSet.has(n); });`,
    `      if (missed.length === 0 && falseFlags.length === 0) {`,
    `        feedback.textContent = 'Correct — you spotted the bug.';`,
    `        feedback.className = 'stb-feedback correct';`,
    `      } else {`,
    `        var parts = [];`,
    `        if (missed.length) parts.push('Missed: line(s) ' + missed.join(', '));`,
    `        if (falseFlags.length) parts.push('False flag: line(s) ' + falseFlags.join(', '));`,
    `        feedback.textContent = parts.join(' — ');`,
    `        feedback.className = 'stb-feedback incorrect';`,
    `      }`,
    `      explanation.hidden = false;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/** Function signature every renderer must satisfy. */
export type WidgetRenderer = (widget: WidgetSpec) => string;

const REGISTRY: Map<WidgetKind, WidgetRenderer> = new Map();

/** Register (or replace) a renderer for a given widget kind. */
export function registerRenderer(kind: string, fn: WidgetRenderer): void {
  REGISTRY.set(kind as WidgetKind, fn);
}

/** Look up the renderer (or `undefined`). */
export function getRenderer(kind: string): WidgetRenderer | undefined {
  return REGISTRY.get(kind as WidgetKind);
}

/** Render a single widget. Throws if no renderer is registered for `widget.type`. */
export function renderWidget(widget: WidgetSpec): string {
  const fn = REGISTRY.get(widget.type);
  if (!fn) throw new Error(`NotImplemented: ${widget.type}`);
  return fn(widget);
}

// ---------------------------------------------------------------------------
// Wave-2 stub registrations — every kind throws until a later wave overrides.
// ---------------------------------------------------------------------------
for (const kind of WIDGET_KINDS) {
  REGISTRY.set(kind, () => {
    throw new Error(`NotImplemented: ${kind}`);
  });
}

// ---------------------------------------------------------------------------
// Wave-4 concrete renderers (override the Wave-2 throwing stubs).
// ---------------------------------------------------------------------------
registerRenderer('spot-the-bug', (widget) =>
  renderSpotTheBug(widget as SpotTheBugWidget),
);

/** List the kinds currently registered. Useful for sanity tests. */
export function registeredKinds(): WidgetKind[] {
  return Array.from(REGISTRY.keys());
}
