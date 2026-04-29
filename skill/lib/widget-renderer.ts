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

/** Narrowed shape for the code-runner widget (mirrors CodeRunnerWidgetSchema). */
type CodeRunnerWidget = Extract<WidgetSpec, { type: 'code-runner' }>;

/** Narrowed shape for the fill-blank widget (mirrors FillBlankWidgetSchema). */
type FillBlankWidget = Extract<WidgetSpec, { type: 'fill-blank' }>;

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

/**
 * Renderer for `code-runner` widgets (T040, R-03).
 *
 * Two runtime branches:
 *   - `runtime: 'native'` → user code is `eval`'d in the browser with a
 *     `console.log` shim that captures output into the `<pre class="output">`.
 *     Always works inline, no network.
 *   - `runtime: 'pyodide'` → on the FIRST Run-click, we lazy-load Pyodide from
 *     the JSDelivr CDN (R-03: must be lazy, never on page load). If
 *     `navigator.onLine === false` OR the script fetch fails, we render an
 *     inline `<span class="pyodide-unavailable">` message and stop. Subsequent
 *     Run-clicks reuse the loaded interpreter.
 *
 * The schema's `language` field (`python` | `javascript`) is informational —
 * the dispatch is keyed on `runtime`, per R-03.
 */
export function renderCodeRunner(spec: CodeRunnerWidget): string {
  const id = nextWidgetId('cr');
  const initialCode = spec.initialCode ?? '';
  const runtime = spec.runtime ?? 'native';
  const language = spec.language ?? 'javascript';

  const initialCodeJson = JSON.stringify(initialCode);
  const runtimeJson = JSON.stringify(runtime);
  const languageJson = JSON.stringify(language);

  return [
    `<div class="code-runner" id="${id}" data-widget="code-runner" data-runtime="${escapeHtml(runtime)}" data-language="${escapeHtml(language)}">`,
    `  <textarea class="code-input" spellcheck="false">${escapeHtml(initialCode)}</textarea>`,
    `  <div class="code-controls">`,
    `    <button type="button" class="run-button" data-action="run">Run</button>`,
    `    <span class="cr-status" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <pre class="output"></pre>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var input = root.querySelector('.code-input');`,
    `    var output = root.querySelector('.output');`,
    `    var status = root.querySelector('.cr-status');`,
    `    var btn = root.querySelector('[data-action="run"]');`,
    `    var runtime = ${runtimeJson};`,
    `    var language = ${languageJson};`,
    `    input.value = ${initialCodeJson};`,
    `    var pyodide = null;`,
    `    var pyodideLoading = null;`,
    ``,
    `    function setOutput(text, cls){`,
    `      output.textContent = String(text);`,
    `      output.className = 'output' + (cls ? ' ' + cls : '');`,
    `    }`,
    ``,
    `    function runJs(code){`,
    `      var buf = [];`,
    `      var origLog = console.log;`,
    `      console.log = function(){`,
    `        var parts = [];`,
    `        for (var i = 0; i < arguments.length; i++) {`,
    `          try { parts.push(typeof arguments[i] === 'string' ? arguments[i] : JSON.stringify(arguments[i])); }`,
    `          catch(e) { parts.push(String(arguments[i])); }`,
    `        }`,
    `        buf.push(parts.join(' '));`,
    `      };`,
    `      try {`,
    `        var result = (0, eval)(code);`,
    `        if (typeof result !== 'undefined') buf.push(String(result));`,
    `        setOutput(buf.join('\\n'));`,
    `      } catch(e) {`,
    `        setOutput((e && e.message) ? e.message : String(e), 'error');`,
    `      } finally {`,
    `        console.log = origLog;`,
    `      }`,
    `    }`,
    ``,
    `    function pyodideUnavailable(){`,
    `      output.innerHTML = '<span class="pyodide-unavailable">Pyodide unavailable (offline). Run this lesson with internet access for Python execution.</span>';`,
    `    }`,
    ``,
    `    function loadPyodide(){`,
    `      if (pyodideLoading) return pyodideLoading;`,
    `      if (typeof navigator !== 'undefined' && navigator.onLine === false) {`,
    `        pyodideUnavailable();`,
    `        return Promise.reject(new Error('offline'));`,
    `      }`,
    `      status.textContent = 'Loading Pyodide...';`,
    `      pyodideLoading = new Promise(function(resolve, reject){`,
    `        var s = document.createElement('script');`,
    `        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';`,
    `        s.onload = function(){`,
    `          if (typeof window.loadPyodide !== 'function') { reject(new Error('loadPyodide missing')); return; }`,
    `          window.loadPyodide().then(function(py){ pyodide = py; status.textContent = ''; resolve(py); }, reject);`,
    `        };`,
    `        s.onerror = function(){ reject(new Error('script load failed')); };`,
    `        document.head.appendChild(s);`,
    `      });`,
    `      pyodideLoading.catch(function(){ pyodideLoading = null; pyodideUnavailable(); status.textContent = ''; });`,
    `      return pyodideLoading;`,
    `    }`,
    ``,
    `    function runPython(code){`,
    `      loadPyodide().then(function(py){`,
    `        try {`,
    `          py.runPython('import sys, io\\nsys.stdout = io.StringIO()\\nsys.stderr = io.StringIO()');`,
    `          py.runPython(code);`,
    `          var out = py.runPython('sys.stdout.getvalue()');`,
    `          var err = py.runPython('sys.stderr.getvalue()');`,
    `          setOutput((out || '') + (err ? '\\n' + err : ''));`,
    `        } catch(e) {`,
    `          setOutput((e && e.message) ? e.message : String(e), 'error');`,
    `        }`,
    `      }, function(){ /* unavailable already rendered */ });`,
    `    }`,
    ``,
    `    btn.addEventListener('click', function(){`,
    `      var code = input.value || '';`,
    `      if (runtime === 'pyodide') runPython(code);`,
    `      else runJs(code);`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/**
 * Renderer for `fill-blank` widgets (T055, FR-020).
 *
 * Emits a self-contained HTML fragment:
 *   - <div class="fill-blank"> wrapping the prompt sentence with one <input
 *     class="blank-input" data-blank-index="N"> placeholder per blank. The
 *     sentence template uses `___` (three underscores) as the blank marker;
 *     each occurrence is replaced with an input in document order.
 *   - <button class="check-button">Check</button> + <div class="feedback">.
 *
 * On Check (inline IIFE), each user input is normalised:
 *   1. trim + lowercase
 *   2. NFD-decompose (split chars into base + combining marks)
 *   3. strip combining diacritical marks (U+0300..U+036F)
 *   4. re-NFC
 * The same transform is applied to each accepted answer (`answer` plus any
 * `alternates`). Result: `caffè ≡ caffe`, `niño ≡ nino`, `naïve ≡ naive`.
 *
 * Each blank gets `.correct` / `.incorrect` class; feedback shows total
 * correct + reveals the canonical answer for any incorrect blank.
 *
 * Note on contract: the widget-spec schema's `FillBlankWidgetSchema` carries
 * a `fuzzyMatch?: 'umlaut' | 'accent' | 'none'` per-blank flag. FR-020 calls
 * for accent-fold by default, so we apply the diacritic-strip transform
 * unconditionally; setting `fuzzyMatch: 'none'` per blank is currently
 * ignored by the renderer (a future-tightening hook — flagged below).
 */
export function renderFillBlank(spec: FillBlankWidget): string {
  const id = nextWidgetId('fb');
  const sentence = spec.sentence ?? '';
  const blanks = spec.blanks ?? [];

  // Build the prompt by splitting on `___` and interleaving inputs.
  const segments = sentence.split('___');
  const promptParts: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    promptParts.push(escapeHtml(segments[i] ?? ''));
    if (i < segments.length - 1) {
      promptParts.push(
        `<input class="blank-input" type="text" autocomplete="off" ` +
          `spellcheck="false" data-blank-index="${i}" />`,
      );
    }
  }

  // Per-blank acceptance lists (raw — normalisation happens in the IIFE so
  // the user sees the canonical/displayed answer on reveal).
  const acceptedRaw = blanks.map((b) => {
    const all = [b.answer, ...(b.alternates ?? [])];
    return { answer: b.answer, accepted: all };
  });
  const acceptedJson = JSON.stringify(acceptedRaw);

  return [
    `<div class="fill-blank" id="${id}" data-widget="fill-blank">`,
    `  <div class="fb-prompt">${promptParts.join('')}</div>`,
    `  <div class="fb-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `  </div>`,
    `  <div class="feedback" role="status" aria-live="polite"></div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var accepted = ${acceptedJson};`,
    `    function normalize(s){`,
    `      if (s == null) return '';`,
    `      var t = String(s).trim().toLowerCase();`,
    `      try { t = t.normalize('NFD'); } catch(e) {}`,
    `      t = t.replace(/[\\u0300-\\u036f]/g, '');`,
    `      try { t = t.normalize('NFC'); } catch(e) {}`,
    `      return t;`,
    `    }`,
    `    var inputs = root.querySelectorAll('.blank-input');`,
    `    var feedback = root.querySelector('.feedback');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    btn.addEventListener('click', function(){`,
    `      var correctCount = 0;`,
    `      var misses = [];`,
    `      inputs.forEach(function(inp, idx){`,
    `        var spec = accepted[idx];`,
    `        if (!spec) return;`,
    `        var userN = normalize(inp.value);`,
    `        var ok = spec.accepted.some(function(a){ return normalize(a) === userN && userN.length > 0; });`,
    `        inp.classList.remove('correct', 'incorrect');`,
    `        inp.classList.add(ok ? 'correct' : 'incorrect');`,
    `        if (ok) correctCount += 1;`,
    `        else misses.push('blank ' + (idx + 1) + ': ' + spec.answer);`,
    `      });`,
    `      var total = inputs.length;`,
    `      var msg = correctCount + ' / ' + total + ' correct.';`,
    `      if (misses.length) msg += ' Correct answers — ' + misses.join('; ') + '.';`,
    `      feedback.textContent = msg;`,
    `      feedback.className = 'feedback ' + (correctCount === total ? 'correct' : 'incorrect');`,
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

registerRenderer('code-runner', (widget) =>
  renderCodeRunner(widget as CodeRunnerWidget),
);

registerRenderer('fill-blank', (widget) =>
  renderFillBlank(widget as FillBlankWidget),
);

/** List the kinds currently registered. Useful for sanity tests. */
export function registeredKinds(): WidgetKind[] {
  return Array.from(REGISTRY.keys());
}
