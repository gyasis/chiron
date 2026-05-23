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

/** Narrowed shape for the mcq-clinical-vignette widget. */
type McqClinicalVignetteWidget = Extract<WidgetSpec, { type: 'mcq-clinical-vignette' }>;

/** Narrowed shape for the agreement-matrix widget (T078).
 *
 * Contract gap: `AgreementMatrixWidgetSchema` currently defines only
 * `{ type, statements, classifications, variants }`. The renderer also reads
 * optional `promptText`, `rationale[]`, and `options[]` (column headers) per
 * the task brief — these are NOT YET in the Zod schema. We treat them as
 * optional via a structural intersection so this renderer compiles against
 * the current schema.
 */
type AgreementMatrixWidget = Extract<WidgetSpec, { type: 'agreement-matrix' }> & {
  promptText?: string;
  rationale?: string[];
  options?: string[];
};

/** Narrowed shape for the code-runner widget (mirrors CodeRunnerWidgetSchema). */
type CodeRunnerWidget = Extract<WidgetSpec, { type: 'code-runner' }>;

/** Narrowed shape for the assertion-reason widget (mirrors AssertionReasonWidgetSchema). */
type AssertionReasonWidget = Extract<WidgetSpec, { type: 'assertion-reason' }> & {
  explanation?: string;
};

/** Narrowed shape for the fill-blank widget (mirrors FillBlankWidgetSchema). */
type FillBlankWidget = Extract<WidgetSpec, { type: 'fill-blank' }>;

/** Narrowed shape for the matching-pair widget (mirrors MatchingPairWidgetSchema). */
type MatchingPairWidget = Extract<WidgetSpec, { type: 'matching-pair' }>;

/** Narrowed shape for the cloze widget (mirrors ClozeWidgetSchema). */
type ClozeWidget = Extract<WidgetSpec, { type: 'cloze' }>;

/** Narrowed shape for the pathway-diagram widget (T081, US3 — medicine).
 *
 * Contract gap: `PathwayDiagramWidgetSchema` currently defines
 * `{ type, nodes, edges, renderer }`. The renderer brief also references
 * optional `mermaidSource` (raw mermaid graph DSL — bypass auto-generation)
 * and `legend` (symbol/meaning rows shown beneath the diagram). We carry
 * those as optional structural fields until a schema PR lands.
 */
type PathwayDiagramWidget = Extract<WidgetSpec, { type: 'pathway-diagram' }> & {
  mermaidSource?: string;
  legend?: Array<{ symbol: string; meaning: string }>;
};

/** Narrowed shape for the audio-tts widget (mirrors AudioTtsWidgetSchema).
 *
 * NOTE — contract gap: as of T058, `AudioTtsWidgetSchema` only defines
 * `{ type, transcript, voice }`. The renderer also reads optional
 * `audioPath`, `speaker`, and `language` fields per the task brief — these
 * are NOT YET in the Zod schema. Tightening will land when the upstream TTS
 * pipeline is implemented (provider selection PRD pending). Until then we
 * treat them as optional via a structural intersection so this renderer
 * compiles against the current schema.
 */
type AudioTtsWidget = Extract<WidgetSpec, { type: 'audio-tts' }> & {
  audioPath?: string;
  speaker?: string;
  language?: string;
};

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

/**
 * Renderer for `matching-pair` widgets (T056, FR-020).
 *
 * Two visual modes (per `spec.mode`):
 *   - `1to1`: each left prompt pairs with exactly one right match. Clicking a
 *     left then a right cell creates a pair (each side de-pairs from any
 *     existing partner). Re-clicking an already-paired cell un-pairs it.
 *   - `NtoN`: a left item may pair with multiple right items and vice versa.
 *     Clicks toggle individual (left, right) cells in an N×M relation.
 *
 * Right-column order is shuffled at render time using a deterministic seeded
 * Fisher–Yates so output is stable across re-renders of the same spec.
 *
 * On Check, user pairs are compared to `spec.pairs[]` (canonical answer set).
 * Per-pair correctness is highlighted; canonical answers are revealed.
 */
export function renderMatchingPair(spec: MatchingPairWidget): string {
  const id = nextWidgetId('mp');
  const pairs = spec.pairs ?? [];
  const mode = spec.mode ?? '1to1';

  // Deterministic seed derived from the spec content so re-renders are stable.
  let seed = 0;
  const seedSrc = `${id}|${mode}|${pairs.map((p) => `${p.left}=${p.right}`).join('|')}`;
  for (let i = 0; i < seedSrc.length; i += 1) {
    seed = (seed * 31 + seedSrc.charCodeAt(i)) | 0;
  }
  // Mulberry32 — small, deterministic PRNG.
  function rand(): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Indices [0..N-1] then Fisher–Yates with the seeded RNG.
  const rightIndices = pairs.map((_, i) => i);
  for (let i = rightIndices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = rightIndices[i]!;
    rightIndices[i] = rightIndices[j]!;
    rightIndices[j] = tmp;
  }

  const promptItems = pairs
    .map(
      (p, i) =>
        `<li class="prompt-item" data-left-index="${i}" role="button" tabindex="0">` +
        escapeHtml(p.left) +
        `</li>`,
    )
    .join('\n');

  const matchItems = rightIndices
    .map(
      (origIdx) =>
        `<li class="match-item" data-right-index="${origIdx}" role="button" tabindex="0">` +
        escapeHtml(pairs[origIdx]!.right) +
        `</li>`,
    )
    .join('\n');

  const pairsJson = JSON.stringify(pairs.map((p, i) => ({ left: i, right: i, leftText: p.left, rightText: p.right })));
  const modeJson = JSON.stringify(mode);

  return [
    `<div class="matching-pair" id="${id}" data-widget="matching-pair" data-mode="${escapeHtml(mode)}">`,
    `  <div class="mp-columns">`,
    `    <ul class="prompts">`,
    promptItems,
    `    </ul>`,
    `    <ul class="matches">`,
    matchItems,
    `    </ul>`,
    `  </div>`,
    `  <div class="mp-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <button type="button" class="reset-button" data-action="reset">Reset</button>`,
    `    <span class="mp-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="mp-reveal" hidden></div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var mode = ${modeJson};`,
    `    var canonical = ${pairsJson};`,
    `    var prompts = root.querySelectorAll('.prompt-item');`,
    `    var matches = root.querySelectorAll('.match-item');`,
    `    var feedback = root.querySelector('.mp-feedback');`,
    `    var reveal = root.querySelector('.mp-reveal');`,
    `    var selectedLeft = null;`,
    `    var selectedRight = null;`,
    `    // userPairs: array of {left:int, right:int}`,
    `    var userPairs = [];`,
    ``,
    `    function pairKey(l, r){ return l + ':' + r; }`,
    `    function hasPair(l, r){`,
    `      for (var i = 0; i < userPairs.length; i++){`,
    `        if (userPairs[i].left === l && userPairs[i].right === r) return true;`,
    `      } return false;`,
    `    }`,
    `    function removePair(l, r){`,
    `      userPairs = userPairs.filter(function(p){ return !(p.left === l && p.right === r); });`,
    `    }`,
    `    function leftHasAny(l){ return userPairs.some(function(p){ return p.left === l; }); }`,
    `    function rightHasAny(r){ return userPairs.some(function(p){ return p.right === r; }); }`,
    ``,
    `    function repaint(){`,
    `      prompts.forEach(function(el){`,
    `        var l = parseInt(el.getAttribute('data-left-index'), 10);`,
    `        el.classList.toggle('paired', leftHasAny(l));`,
    `        el.classList.toggle('selected', selectedLeft === l);`,
    `        el.classList.remove('correct', 'incorrect');`,
    `      });`,
    `      matches.forEach(function(el){`,
    `        var r = parseInt(el.getAttribute('data-right-index'), 10);`,
    `        el.classList.toggle('paired', rightHasAny(r));`,
    `        el.classList.toggle('selected', selectedRight === r);`,
    `        el.classList.remove('correct', 'incorrect');`,
    `      });`,
    `    }`,
    ``,
    `    function tryCommit(){`,
    `      if (selectedLeft == null || selectedRight == null) return;`,
    `      var l = selectedLeft, r = selectedRight;`,
    `      if (hasPair(l, r)) {`,
    `        // re-click toggles off`,
    `        removePair(l, r);`,
    `      } else {`,
    `        if (mode === '1to1') {`,
    `          // remove any existing pairing for this left or right`,
    `          userPairs = userPairs.filter(function(p){ return p.left !== l && p.right !== r; });`,
    `        }`,
    `        userPairs.push({ left: l, right: r });`,
    `      }`,
    `      selectedLeft = null;`,
    `      selectedRight = null;`,
    `      repaint();`,
    `    }`,
    ``,
    `    prompts.forEach(function(el){`,
    `      el.addEventListener('click', function(){`,
    `        var l = parseInt(el.getAttribute('data-left-index'), 10);`,
    `        selectedLeft = (selectedLeft === l) ? null : l;`,
    `        repaint();`,
    `        tryCommit();`,
    `      });`,
    `    });`,
    `    matches.forEach(function(el){`,
    `      el.addEventListener('click', function(){`,
    `        var r = parseInt(el.getAttribute('data-right-index'), 10);`,
    `        selectedRight = (selectedRight === r) ? null : r;`,
    `        repaint();`,
    `        tryCommit();`,
    `      });`,
    `    });`,
    ``,
    `    var checkBtn = root.querySelector('[data-action="check"]');`,
    `    var resetBtn = root.querySelector('[data-action="reset"]');`,
    `    checkBtn.addEventListener('click', function(){`,
    `      // Canonical pair set = {left==right index}`,
    `      var correctCount = 0;`,
    `      var canonSet = {};`,
    `      for (var i = 0; i < canonical.length; i++) canonSet[pairKey(canonical[i].left, canonical[i].right)] = true;`,
    `      // Mark prompt and match items based on whether they participate in any correct user pair.`,
    `      var leftCorrect = {}, rightCorrect = {};`,
    `      var leftFlagged = {}, rightFlagged = {};`,
    `      userPairs.forEach(function(p){`,
    `        leftFlagged[p.left] = true; rightFlagged[p.right] = true;`,
    `        if (canonSet[pairKey(p.left, p.right)]) {`,
    `          correctCount++;`,
    `          leftCorrect[p.left] = true; rightCorrect[p.right] = true;`,
    `        }`,
    `      });`,
    `      prompts.forEach(function(el){`,
    `        var l = parseInt(el.getAttribute('data-left-index'), 10);`,
    `        if (leftCorrect[l]) el.classList.add('correct');`,
    `        else if (leftFlagged[l]) el.classList.add('incorrect');`,
    `      });`,
    `      matches.forEach(function(el){`,
    `        var r = parseInt(el.getAttribute('data-right-index'), 10);`,
    `        if (rightCorrect[r]) el.classList.add('correct');`,
    `        else if (rightFlagged[r]) el.classList.add('incorrect');`,
    `      });`,
    `      var total = canonical.length;`,
    `      feedback.textContent = correctCount + ' / ' + total + ' correct pair(s).';`,
    `      feedback.className = 'mp-feedback ' + (correctCount === total && userPairs.length === total ? 'correct' : 'incorrect');`,
    `      // Reveal canonical answers`,
    `      var lines = canonical.map(function(p){ return p.leftText + ' ↔ ' + p.rightText; });`,
    `      reveal.innerHTML = '<strong>Answers:</strong><ul>' + lines.map(function(s){`,
    `        return '<li>' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</li>';`,
    `      }).join('') + '</ul>';`,
    `      reveal.hidden = false;`,
    `    });`,
    `    resetBtn.addEventListener('click', function(){`,
    `      userPairs = []; selectedLeft = null; selectedRight = null;`,
    `      reveal.hidden = true; reveal.innerHTML = '';`,
    `      feedback.textContent = ''; feedback.className = 'mp-feedback';`,
    `      repaint();`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/**
 * Renderer for `cloze` widgets (T057).
 *
 * Parses Anki-style cloze markers `{{cN::answer}}` or `{{cN::answer::hint}}`
 * inside `spec.sentence` and replaces each marker with an `<input>`. Multiple
 * markers sharing the same N constitute one cloze "set" — Anki treats them as
 * the same blank (any of the answers is acceptable for any of those inputs);
 * we mirror that with an answer-pool comparison in the IIFE.
 *
 * The wrapper carries `data-anki-compatible="true"` so a future `.apkg`
 * exporter can identify these widgets. `data-cloze-index` uses 1-based N
 * matching Anki's `cN` convention.
 *
 * On Check, each user input is normalised:
 *   1. trim + lowercase
 *   2. NFD-decompose, strip combining marks (U+0300..U+036F)
 *   3. NFC
 * The same transform is applied to every accepted answer in the pool for
 * that input's `cN`. Inputs are tagged `.correct` / `.incorrect`; feedback
 * shows count and reveals canonical answers for incorrect blanks.
 */
export function renderCloze(spec: ClozeWidget): string {
  const id = nextWidgetId('cloze');
  const sentence = spec.sentence ?? '';

  // Parse {{cN::answer}} or {{cN::answer::hint}} markers in document order.
  // We assemble a sentence HTML string with <input> tags interleaved.
  const markerRe = /\{\{c(\d+)::([^}:]+)(?:::([^}]+))?\}\}/g;
  // Pool: cN -> array of canonical answers (raw, for reveal).
  const pool: Record<string, string[]> = {};
  // Per-input ordered list of (cN, hint).
  const inputs: { cN: number; hint: string }[] = [];

  let cursor = 0;
  const htmlParts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(sentence)) !== null) {
    const before = sentence.slice(cursor, m.index);
    if (before) htmlParts.push(escapeHtml(before));
    const cN = parseInt(m[1]!, 10);
    const answer = (m[2] ?? '').trim();
    const hint = (m[3] ?? '').trim();
    const key = String(cN);
    if (!pool[key]) pool[key] = [];
    if (!pool[key].includes(answer)) pool[key].push(answer);
    inputs.push({ cN, hint });
    cursor = m.index + m[0].length;
  }
  const tail = sentence.slice(cursor);
  if (tail) htmlParts.push(escapeHtml(tail));

  // Now interleave inputs back into the parts. We rebuilt htmlParts with text
  // segments only — but we need inputs at marker positions. Re-walk the
  // sentence to interleave correctly.
  markerRe.lastIndex = 0;
  cursor = 0;
  const finalParts: string[] = [];
  let inputIdx = 0;
  while ((m = markerRe.exec(sentence)) !== null) {
    const before = sentence.slice(cursor, m.index);
    if (before) finalParts.push(escapeHtml(before));
    const cN = inputs[inputIdx]!.cN;
    const hint = inputs[inputIdx]!.hint;
    finalParts.push(
      `<input class="cloze-blank" type="text" autocomplete="off" ` +
        `spellcheck="false" data-cloze-index="${cN}" ` +
        `data-answer="${escapeHtml(pool[String(cN)]![0]!)}" ` +
        `placeholder="${escapeHtml(hint)}" />`,
    );
    inputIdx += 1;
    cursor = m.index + m[0].length;
  }
  const finalTail = sentence.slice(cursor);
  if (finalTail) finalParts.push(escapeHtml(finalTail));

  const poolJson = JSON.stringify(pool);

  return [
    `<div class="cloze" id="${id}" data-widget="cloze" data-anki-compatible="true">`,
    `  <div class="cloze-sentence">${finalParts.join('')}</div>`,
    `  <div class="cloze-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `  </div>`,
    `  <div class="feedback" role="status" aria-live="polite"></div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var pool = ${poolJson};`,
    `    function normalize(s){`,
    `      if (s == null) return '';`,
    `      var t = String(s).trim().toLowerCase();`,
    `      try { t = t.normalize('NFD'); } catch(e) {}`,
    `      t = t.replace(/[\\u0300-\\u036f]/g, '');`,
    `      try { t = t.normalize('NFC'); } catch(e) {}`,
    `      return t;`,
    `    }`,
    `    var inputs = root.querySelectorAll('.cloze-blank');`,
    `    var feedback = root.querySelector('.feedback');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    btn.addEventListener('click', function(){`,
    `      var correctCount = 0;`,
    `      var misses = [];`,
    `      inputs.forEach(function(inp, idx){`,
    `        var cN = inp.getAttribute('data-cloze-index');`,
    `        var answers = pool[cN] || [inp.getAttribute('data-answer') || ''];`,
    `        var userN = normalize(inp.value);`,
    `        var ok = userN.length > 0 && answers.some(function(a){ return normalize(a) === userN; });`,
    `        inp.classList.remove('correct', 'incorrect');`,
    `        inp.classList.add(ok ? 'correct' : 'incorrect');`,
    `        if (ok) correctCount += 1;`,
    `        else misses.push('blank ' + (idx + 1) + ': ' + (inp.getAttribute('data-answer') || ''));`,
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

registerRenderer('matching-pair', (widget) =>
  renderMatchingPair(widget as MatchingPairWidget),
);

registerRenderer('cloze', (widget) => renderCloze(widget as ClozeWidget));

// ---------------------------------------------------------------------------
// Multi-set Match Madness (PRD canonical_shell_and_match_madness §4.10–4.12,
// 2026-05-14). Universal retrieval-practice anchor — vocab / gender / prep /
// collocation / conjugation / mixed modes. The widget itself is domain-
// agnostic; per-language helpers (Italian conjugator) live in widgets/.
// ---------------------------------------------------------------------------
import { emitMatchMadness } from './widgets/match-madness.js';
import { emitSrDeck, emitSrCardCss } from './widgets/sr-card.js';

type MatchMadnessWidget = Extract<WidgetSpec, { type: 'match-madness' }>;
type LanguageFlashcardDeckWidget = Extract<WidgetSpec, { type: 'language-flashcard-deck' }>;

/** Match Madness — emit HTML + scoped <style> + IIFE <script>. */
export function renderMatchMadness(spec: MatchMadnessWidget): string {
  const emitted = emitMatchMadness({
    lessonId: spec.lessonId,
    domain: spec.domain,
    title: spec.title,
    description: spec.description,
    defaults: spec.defaults,
    sets: spec.sets,
    unlockAccuracyThreshold: spec.unlockAccuracyThreshold,
    superSetUnlockAfterNSetsCompleted: spec.superSetUnlockAfterNSetsCompleted,
  });
  return [
    `<section class="chiron-widget match-madness-widget" data-widget-type="match-madness">`,
    `<style>${emitted.css}</style>`,
    emitted.html,
    `<script>${emitted.js}</script>`,
    `</section>`,
  ].join('\n');
}

registerRenderer('match-madness', (widget) =>
  renderMatchMadness(widget as MatchMadnessWidget),
);

/** Rich language flashcard deck — verb conjugation tables + nouns + idioms. */
export function renderLanguageFlashcardDeck(spec: LanguageFlashcardDeckWidget): string {
  // The flip-on-click JS is shared by every deck on the page; emit once per widget
  // instance (duplicate `forEach` listeners on the same DOM are idempotent enough).
  const flipJs = `
    (function () {
      document.querySelectorAll('[data-widget-type="language-flashcard-deck"] .sr-card').forEach(function (card) {
        card.addEventListener('click', function () { card.classList.toggle('flipped'); });
      });
    })();`;
  return [
    `<section class="chiron-widget language-flashcard-deck" data-widget-type="language-flashcard-deck" data-language="${spec.language}">`,
    `<style>${emitSrCardCss()}</style>`,
    `<div class="sr-deck">`,
    emitSrDeck({ verbs: spec.verbs, nouns: spec.nouns, idioms: spec.idioms }),
    `</div>`,
    `<script>${flipJs}</script>`,
    `</section>`,
  ].join('\n');
}

registerRenderer('language-flashcard-deck', (widget) =>
  renderLanguageFlashcardDeck(widget as LanguageFlashcardDeckWidget),
);

/**
 * Renderer for `audio-tts` widgets (T058, US2 — Italian native-speaker persona).
 *
 * SCOPE: HTML emission only. The TTS-provider question (Gemini vs ElevenLabs
 * etc.) is tabled in `~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md`
 * and is OUT OF SCOPE for this renderer. We assume an upstream pipeline has
 * already produced an MP3 at `spec.audioPath` (typically
 * `<lesson-output-dir>/audio/<clip>.mp3`); this renderer just points at it.
 *
 * Emits:
 *   - <audio controls preload="none" src="..."> — `preload="none"` keeps
 *     bandwidth zero until user interacts.
 *   - <details><summary>Transcript</summary><p class="transcript-text">...</p></details>
 *     — collapsed by default, opens for screen-reader / silent-mode users.
 *   - `lang="<code>"` on the transcript paragraph when `spec.language` is
 *     supplied (e.g. `'it'` for Italian) so AT pronounces it correctly.
 *   - `data-speaker` and `data-tts-voice` for cross-referencing with the
 *     voice catalog the TTS-provider PRD will define.
 *   - `<div class="audio-fallback" hidden>` shown when the `<audio>` element
 *     fires `error` (file missing / decode failure / CORS).
 *   - On `ended`, dispatches a bubbling `chiron:audio-ended` CustomEvent so a
 *     later wave can prompt SR-card review when the clip finishes.
 *
 * Contract gaps surfaced by this implementation (flagged for a future schema PR):
 *   1. `AudioTtsWidgetSchema` lacks `audioPath` — required for HTML rendering.
 *   2. `AudioTtsWidgetSchema` lacks `speaker?` — required for multi-persona
 *      lessons (Alice/Bob/Native-Speaker).
 *   3. `AudioTtsWidgetSchema` lacks `language?` — required for `lang=` a11y.
 *   4. `voice` is currently a free-form string — should become an enum once
 *      the TTS-provider PRD lands a voice catalog.
 */
export function renderAudioTts(spec: AudioTtsWidget): string {
  const id = nextWidgetId('att');
  const audioPath = spec.audioPath ?? '';
  const transcript = spec.transcript ?? '';
  const voice = spec.voice ?? '';
  const speaker = spec.speaker ?? '';
  const language = spec.language ?? '';

  const langAttr = language ? ` lang="${escapeHtml(language)}"` : '';
  const speakerAttr = speaker ? ` data-speaker="${escapeHtml(speaker)}"` : '';
  const voiceAttr = voice ? ` data-tts-voice="${escapeHtml(voice)}"` : '';

  return [
    `<div class="audio-tts" id="${id}" data-widget="audio-tts"${speakerAttr}${voiceAttr}>`,
    `  <audio controls preload="none" src="${escapeHtml(audioPath)}"></audio>`,
    `  <details class="transcript">`,
    `    <summary>Transcript</summary>`,
    `    <p class="transcript-text"${langAttr}>${escapeHtml(transcript)}</p>`,
    `  </details>`,
    `  <div class="audio-fallback" hidden>`,
    `    Audio unavailable — see transcript below.`,
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var audio = root.querySelector('audio');`,
    `    var fallback = root.querySelector('.audio-fallback');`,
    `    var details = root.querySelector('details.transcript');`,
    `    if (!audio) return;`,
    `    audio.addEventListener('error', function(){`,
    `      audio.hidden = true;`,
    `      if (fallback) fallback.hidden = false;`,
    `      if (details) details.open = true;`,
    `    });`,
    `    audio.addEventListener('ended', function(){`,
    `      try {`,
    `        root.dispatchEvent(new CustomEvent('chiron:audio-ended', {`,
    `          bubbles: true,`,
    `          detail: { widgetId: ${JSON.stringify(id)} }`,
    `        }));`,
    `      } catch(e) { /* CustomEvent unsupported — silent */ }`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

registerRenderer('audio-tts', (widget) =>
  renderAudioTts(widget as AudioTtsWidget),
);

/**
 * Renderer for `mcq-clinical-vignette` widgets (T077, US3 — medicine domain).
 *
 * Emits a self-contained HTML fragment matching the USMLE/AMBOSS-style clinical
 * vignette layout:
 *   - Vignette block with the case narrative + key-info chips highlighting the
 *     salient clinical features the learner should extract.
 *   - Leading question (stem) below the vignette.
 *   - Five-option layout (1 correct + 1 close-but-wrong + 2 standard distractors
 *     + 1 obviously-wrong, per USMLE distractor pattern). Options are rendered
 *     as a radio-style group — only one selectable at a time.
 *   - Hammer rating chip (1–3) using filled / half / empty stars to convey
 *     difficulty.
 *   - Attending Tip callout (Dr. Reyes persona) revealed after Check.
 *
 * On Check (inline IIFE): reveal `.explanation` divs for ALL 5 options, mark
 * selected vs correct, show Attending Tip, and lock the widget so the learner
 * cannot re-answer to game the assessment.
 */
export function renderMcqClinicalVignette(spec: McqClinicalVignetteWidget): string {
  const id = nextWidgetId('mcv');
  const vignette = spec.vignette ?? '';
  const keyInfo = spec.keyInfo ?? [];
  const stem = spec.stem ?? '';
  const options = spec.options ?? [];
  const hammer = spec.hammer ?? 1;
  const attendingTip = spec.attendingTip ?? '';
  const vignetteCategory = spec.vignetteCategory ?? '';

  const chipsHtml = keyInfo
    .map((k) => `<span class="chip">${escapeHtml(String(k))}</span>`)
    .join('\n        ');

  const letters = ['A', 'B', 'C', 'D', 'E'];
  const optionsHtml = options
    .map((opt, idx) => {
      const letter = letters[idx] ?? String(idx + 1);
      const correct = opt.correct === true ? 'true' : 'false';
      return [
        `      <li class="option" data-correct="${correct}" data-option-letter="${letter}" data-option-index="${idx}">`,
        `        <label class="option-label">`,
        `          <input type="radio" name="${id}-opt" value="${idx}" />`,
        `          <span class="option-letter">${letter}.</span>`,
        `          <span class="option-text">${escapeHtml(opt.label ?? '')}</span>`,
        `        </label>`,
        `        <div class="explanation" hidden>${escapeHtml(opt.explanation ?? '')}</div>`,
        `      </li>`,
      ].join('\n');
    })
    .join('\n');

  // Hammer chip: ★ filled vs ☆ empty out of 3.
  const hammerInt = Math.max(1, Math.min(3, Math.round(Number(hammer) || 1)));
  const stars = '★'.repeat(hammerInt) + '☆'.repeat(3 - hammerInt);

  return [
    `<div class="mcq-clinical-vignette" id="${id}" data-widget="mcq-clinical-vignette" data-category="${escapeHtml(String(vignetteCategory))}" data-hammer="${hammerInt}">`,
    `  <div class="vignette-block">`,
    `    <div class="vignette-text">${escapeHtml(vignette)}</div>`,
    `    <div class="key-info-chips">`,
    `        ${chipsHtml}`,
    `    </div>`,
    `  </div>`,
    `  <div class="leading-question">${escapeHtml(stem)}</div>`,
    `  <ol class="options" type="A">`,
    optionsHtml,
    `  </ol>`,
    `  <div class="mcv-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="mcv-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="hammer-chip" title="Difficulty">Hammer: ${stars} (${hammerInt}/3)</div>`,
    `  <div class="attending-tip" hidden>`,
    `    <strong>Attending Tip — Dr. Reyes:</strong>`,
    `    <p>${escapeHtml(attendingTip)}</p>`,
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var optionEls = root.querySelectorAll('.option');`,
    `    var radios = root.querySelectorAll('input[type="radio"][name="${id}-opt"]');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    var feedback = root.querySelector('.mcv-feedback');`,
    `    var tip = root.querySelector('.attending-tip');`,
    `    var locked = false;`,
    `    btn.addEventListener('click', function(){`,
    `      if (locked) return;`,
    `      var selectedIdx = -1;`,
    `      radios.forEach(function(r){ if (r.checked) selectedIdx = parseInt(r.value, 10); });`,
    `      if (selectedIdx < 0) {`,
    `        feedback.textContent = 'Pick an option first.';`,
    `        feedback.className = 'mcv-feedback';`,
    `        return;`,
    `      }`,
    `      var correctIdx = -1;`,
    `      optionEls.forEach(function(el){`,
    `        var idx = parseInt(el.getAttribute('data-option-index'), 10);`,
    `        var isCorrect = el.getAttribute('data-correct') === 'true';`,
    `        if (isCorrect) correctIdx = idx;`,
    `        var exp = el.querySelector('.explanation');`,
    `        if (exp) exp.hidden = false;`,
    `        el.classList.remove('selected', 'correct', 'incorrect');`,
    `        if (isCorrect) el.classList.add('correct');`,
    `        if (idx === selectedIdx && !isCorrect) el.classList.add('incorrect');`,
    `        if (idx === selectedIdx) el.classList.add('selected');`,
    `      });`,
    `      var ok = selectedIdx === correctIdx;`,
    `      feedback.textContent = ok ? 'Correct.' : 'Incorrect — see Attending Tip below.';`,
    `      feedback.className = 'mcv-feedback ' + (ok ? 'correct' : 'incorrect');`,
    `      if (tip) tip.hidden = false;`,
    `      // Lock — no re-answer.`,
    `      radios.forEach(function(r){ r.disabled = true; });`,
    `      btn.disabled = true;`,
    `      locked = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

registerRenderer('mcq-clinical-vignette', (widget) =>
  renderMcqClinicalVignette(widget as McqClinicalVignetteWidget),
);

/**
 * Renderer for `agreement-matrix` widgets (T078, US3 — medicine domain).
 *
 * Emits an N-row × 3-column grid (Always / Sometimes / Never per FR-018) where
 * each row is one statement and the learner picks one classification via radio.
 * On Check (inline IIFE):
 *   - Per row: read selected radio value → compare to `spec.classifications[i]`
 *     (canonical, lowercase). Mark `<tr>` `.correct`, `.incorrect`, or
 *     `.unanswered` (no selection).
 *   - Show "X / N rows correct" beneath the matrix.
 *   - Reveal the `.rationale` block (one `<li>` per row) so the learner sees
 *     2-3 sentences of explanation per statement.
 *   - Lock the matrix (disable all radios + the Check button) so the learner
 *     cannot re-answer to game the assessment.
 *
 * Schema-vs-brief: `AgreementMatrixWidgetSchema` only defines
 * `statements[]` + `classifications[]`. The brief also references optional
 * `promptText`, `rationale[]`, and `options[]` (custom column headers) —
 * carried as optional structural fields until a schema PR lands.
 */
export function renderAgreementMatrix(spec: AgreementMatrixWidget): string {
  const id = nextWidgetId('am');
  const statements = spec.statements ?? [];
  const classifications = spec.classifications ?? [];
  const rationale = spec.rationale ?? [];
  const promptText = spec.promptText ?? '';
  const headers =
    spec.options && spec.options.length === 3
      ? spec.options
      : ['Always', 'Sometimes', 'Never'];

  const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');

  const rowsHtml = statements
    .map((stmt, i) => {
      return [
        `        <tr data-row-index="${i}">`,
        `          <td class="statement">${escapeHtml(stmt)}</td>`,
        `          <td><input type="radio" name="${id}-row-${i}" value="always" /></td>`,
        `          <td><input type="radio" name="${id}-row-${i}" value="sometimes" /></td>`,
        `          <td><input type="radio" name="${id}-row-${i}" value="never" /></td>`,
        `        </tr>`,
      ].join('\n');
    })
    .join('\n');

  const rationaleHtml = statements
    .map((_, i) => {
      const text = rationale[i] ?? '';
      return `        <li class="rationale-row" data-row-index="${i}">${escapeHtml(text)}</li>`;
    })
    .join('\n');

  const classificationsJson = JSON.stringify(
    classifications.map((c) => String(c).toLowerCase()),
  );

  return [
    `<div class="agreement-matrix" id="${id}" data-widget="agreement-matrix">`,
    `  <p class="prompt-text">${escapeHtml(promptText)}</p>`,
    `  <table class="matrix">`,
    `    <thead>`,
    `      <tr><th>Statement</th>${headerHtml}</tr>`,
    `    </thead>`,
    `    <tbody>`,
    rowsHtml,
    `    </tbody>`,
    `  </table>`,
    `  <div class="am-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="am-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="rationale" hidden>`,
    `    <ol>`,
    rationaleHtml,
    `    </ol>`,
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var canonical = ${classificationsJson};`,
    `    var rows = root.querySelectorAll('tbody tr');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    var feedback = root.querySelector('.am-feedback');`,
    `    var rationale = root.querySelector('.rationale');`,
    `    var locked = false;`,
    `    btn.addEventListener('click', function(){`,
    `      if (locked) return;`,
    `      var correctCount = 0;`,
    `      var total = rows.length;`,
    `      rows.forEach(function(tr, i){`,
    `        tr.classList.remove('correct', 'incorrect', 'unanswered');`,
    `        var radios = tr.querySelectorAll('input[type="radio"]');`,
    `        var picked = null;`,
    `        radios.forEach(function(r){ if (r.checked) picked = r.value; });`,
    `        if (picked == null) {`,
    `          tr.classList.add('unanswered');`,
    `          return;`,
    `        }`,
    `        if (picked === canonical[i]) {`,
    `          tr.classList.add('correct');`,
    `          correctCount += 1;`,
    `        } else {`,
    `          tr.classList.add('incorrect');`,
    `        }`,
    `      });`,
    `      feedback.textContent = correctCount + ' / ' + total + ' rows correct';`,
    `      feedback.className = 'am-feedback ' + (correctCount === total ? 'correct' : 'incorrect');`,
    `      if (rationale) rationale.hidden = false;`,
    `      // Lock — disable all radios so the user can't game the assessment.`,
    `      root.querySelectorAll('input[type="radio"]').forEach(function(r){ r.disabled = true; });`,
    `      btn.disabled = true;`,
    `      locked = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

registerRenderer('agreement-matrix', (widget) =>
  renderAgreementMatrix(widget as AgreementMatrixWidget),
);

/**
 * Renderer for `assertion-reason` widgets (T079, US3 — medicine domain).
 *
 * Canonical 5-relationship picker (USMLE/advanced-board format, confirmed
 * 2026-04-29 — see `skill/prompts/04j-quiz-assertion-reason.md`):
 *   A. Both A and R are true, and R is the correct explanation of A
 *   B. Both A and R are true, but R is NOT the correct explanation of A
 *   C. A is true, but R is false
 *   D. A is false, but R is true
 *   E. Both A and R are false
 *
 * On Check (inline IIFE):
 *   - If no radio is selected, mark all options `.unanswered` and bail.
 *   - Otherwise mark the chosen option `.selected`, mark the canonical-correct
 *     option `.correct`, and (when wrong) also mark the chosen one `.incorrect`.
 *   - Reveal the `.explanation` block.
 *   - Lock all radios + the Check button so the learner cannot re-answer.
 *
 * Contract gap: `AssertionReasonWidgetSchema` doesn't yet declare an
 * `explanation` field — carried as optional structural until a schema PR lands.
 */
export function renderAssertionReason(spec: AssertionReasonWidget): string {
  const id = nextWidgetId('ar');
  const assertion = spec.assertion ?? '';
  const reason = spec.reason ?? '';
  const correctRel = spec.correctRelationship;
  const explanation = spec.explanation ?? '';

  const relationships: { key: string; letter: string; label: string }[] = [
    {
      key: 'both-true-reason-explains',
      letter: 'A',
      label: 'Both A and R are true, and R is the correct explanation of A',
    },
    {
      key: 'both-true-reason-doesnt-explain',
      letter: 'B',
      label: 'Both A and R are true, but R is NOT the correct explanation of A',
    },
    {
      key: 'assertion-true-reason-false',
      letter: 'C',
      label: 'A is true, but R is false',
    },
    {
      key: 'assertion-false-reason-true',
      letter: 'D',
      label: 'A is false, but R is true',
    },
    {
      key: 'both-false',
      letter: 'E',
      label: 'Both A and R are false',
    },
  ];

  const optionsHtml = relationships
    .map((rel) => {
      const isCorrect = rel.key === correctRel ? 'true' : 'false';
      return [
        `      <li class="option" data-relationship="${rel.key}" data-correct="${isCorrect}">`,
        `        <label class="option-label">`,
        `          <input type="radio" name="${id}-rel" value="${rel.key}" />`,
        `          <span class="label">${rel.letter}.</span>`,
        `          <span class="option-text">${escapeHtml(rel.label)}</span>`,
        `        </label>`,
        `      </li>`,
      ].join('\n');
    })
    .join('\n');

  return [
    `<div class="assertion-reason" id="${id}" data-widget="assertion-reason">`,
    `  <div class="assertion"><strong>Assertion (A):</strong> ${escapeHtml(assertion)}</div>`,
    `  <div class="connector">BECAUSE</div>`,
    `  <div class="reason"><strong>Reason (R):</strong> ${escapeHtml(reason)}</div>`,
    `  <ol class="relationship-options" type="A">`,
    optionsHtml,
    `  </ol>`,
    `  <div class="ar-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="ar-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="explanation" hidden>${escapeHtml(explanation)}</div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var optionEls = root.querySelectorAll('.option');`,
    `    var radios = root.querySelectorAll('input[type="radio"][name="${id}-rel"]');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    var feedback = root.querySelector('.ar-feedback');`,
    `    var explanation = root.querySelector('.explanation');`,
    `    var locked = false;`,
    `    btn.addEventListener('click', function(){`,
    `      if (locked) return;`,
    `      var picked = null;`,
    `      radios.forEach(function(r){ if (r.checked) picked = r.value; });`,
    `      if (picked == null) {`,
    `        optionEls.forEach(function(el){ el.classList.add('unanswered'); });`,
    `        feedback.textContent = 'Pick a relationship first.';`,
    `        feedback.className = 'ar-feedback';`,
    `        return;`,
    `      }`,
    `      var ok = false;`,
    `      optionEls.forEach(function(el){`,
    `        el.classList.remove('selected', 'correct', 'incorrect', 'unanswered');`,
    `        var rel = el.getAttribute('data-relationship');`,
    `        var isCorrect = el.getAttribute('data-correct') === 'true';`,
    `        if (isCorrect) el.classList.add('correct');`,
    `        if (rel === picked) {`,
    `          el.classList.add('selected');`,
    `          if (!isCorrect) el.classList.add('incorrect');`,
    `          else ok = true;`,
    `        }`,
    `      });`,
    `      feedback.textContent = ok ? 'Correct.' : 'Incorrect — see explanation below.';`,
    `      feedback.className = 'ar-feedback ' + (ok ? 'correct' : 'incorrect');`,
    `      if (explanation) explanation.hidden = false;`,
    `      // Lock — no re-answer.`,
    `      radios.forEach(function(r){ r.disabled = true; });`,
    `      btn.disabled = true;`,
    `      locked = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

registerRenderer('assertion-reason', (widget) =>
  renderAssertionReason(widget as AssertionReasonWidget),
);

/**
 * Renderer for `pathway-diagram` widgets (T081, US3 — medicine domain).
 *
 * Two render paths driven by `spec.renderer`:
 *
 *   - `'mermaid'` — Use the vendored Mermaid library at runtime
 *     (`window.mermaid`). If `spec.mermaidSource` is provided, it's used
 *     verbatim inside `<div class="mermaid">`. Otherwise we synthesise a
 *     `graph LR` diagram from `nodes` + `edges`. An inline IIFE calls
 *     `mermaid.init()` idempotently on first render so the diagram
 *     renders even if the page already passed Mermaid's autoload phase.
 *
 *   - `'d3-custom'` — Emit an `<svg>` and lay out the nodes left-to-right
 *     using a minimal in-line topological-sort layout in vanilla JS (no
 *     d3 dependency). Nodes are `<g><rect/><text/></g>`; edges are
 *     `<line marker-end="url(#arrow-<id>)">` with one `<defs><marker>`
 *     per widget instance (id-namespaced to avoid collisions when the
 *     page hosts multiple pathway diagrams).
 *
 * Optional `spec.legend` renders as a `<dl class="pathway-legend">` below
 * the diagram so the learner can map symbols (e.g. ⊕ activator, ⊖ inhibitor)
 * to meaning.
 *
 * Used in medicine for biochemical pathways (glycolysis, TCA cycle, beta-
 * oxidation), in research-paper for methodology flow charts, and
 * occasionally in code for state-machine diagrams.
 *
 * Contract gaps surfaced (flagged for a future schema PR):
 *   1. `mermaidSource?: string` — raw Mermaid DSL bypass (medicine pathways
 *      sometimes ship as hand-tuned mermaid for visual fidelity).
 *   2. `legend?: Array<{symbol, meaning}>` — symbol legend table.
 */
export function renderPathwayDiagram(spec: PathwayDiagramWidget): string {
  const id = nextWidgetId('pd');
  const renderer = spec.renderer;
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const legend = spec.legend ?? [];

  // Legend block (shared by both render paths).
  const legendHtml =
    legend.length > 0
      ? [
          `  <dl class="pathway-legend">`,
          ...legend.flatMap((row) => [
            `    <dt>${escapeHtml(row.symbol ?? '')}</dt>`,
            `    <dd>${escapeHtml(row.meaning ?? '')}</dd>`,
          ]),
          `  </dl>`,
        ].join('\n')
      : '';

  if (renderer === 'mermaid') {
    // Use spec.mermaidSource if provided; otherwise synthesise from nodes+edges.
    let source = (spec.mermaidSource ?? '').trim();
    if (!source) {
      const lines: string[] = ['graph LR'];
      for (const n of nodes) {
        // Mermaid node syntax: id["label"] — quote labels to allow spaces/punct.
        const safeLabel = String(n.label ?? '').replace(/"/g, '&quot;');
        lines.push(`  ${n.id}["${safeLabel}"]`);
      }
      for (const e of edges) {
        if (e.label) {
          const safeEdgeLabel = String(e.label).replace(/\|/g, '');
          lines.push(`  ${e.from} -->|${safeEdgeLabel}| ${e.to}`);
        } else {
          lines.push(`  ${e.from} --> ${e.to}`);
        }
      }
      source = lines.join('\n');
    }

    return [
      `<div class="pathway-diagram" id="${id}" data-widget="pathway-diagram" data-renderer="mermaid">`,
      `  <div class="mermaid">${escapeHtml(source)}</div>`,
      legendHtml,
      `  <script>`,
      `  (function(){`,
      `    var root = document.getElementById(${JSON.stringify(id)});`,
      `    if (!root) return;`,
      `    function tryInit(){`,
      `      if (typeof window === 'undefined' || !window.mermaid) return false;`,
      `      try {`,
      `        if (typeof window.mermaid.run === 'function') {`,
      `          window.mermaid.run({ nodes: root.querySelectorAll('.mermaid') });`,
      `        } else if (typeof window.mermaid.init === 'function') {`,
      `          window.mermaid.init(undefined, root.querySelectorAll('.mermaid'));`,
      `        }`,
      `        return true;`,
      `      } catch(e) { return false; }`,
      `    }`,
      `    if (!tryInit()) {`,
      `      // Mermaid not yet loaded — retry after DOMContentLoaded / window.load.`,
      `      var fired = false;`,
      `      function retry(){ if (!fired && tryInit()) fired = true; }`,
      `      if (document.readyState === 'loading') {`,
      `        document.addEventListener('DOMContentLoaded', retry);`,
      `      }`,
      `      window.addEventListener('load', retry);`,
      `    }`,
      `  })();`,
      `  </script>`,
      `</div>`,
    ]
      .filter((s) => s.length > 0)
      .join('\n');
  }

  // ---------- D3-custom path (vanilla JS, no d3 dep) ----------

  // Pre-compute a stable topological order at render time so the layout is
  // deterministic across page loads. Cycle-safe: nodes whose deps form a
  // cycle drop into the next available column.
  const idIndex: Record<string, number> = {};
  nodes.forEach((n, i) => {
    idIndex[n.id] = i;
  });
  const incoming: number[] = nodes.map(() => 0);
  for (const e of edges) {
    const ti = idIndex[e.to];
    if (ti != null) incoming[ti] = (incoming[ti] ?? 0) + 1;
  }
  const layer: number[] = nodes.map(() => -1);
  const queue: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if ((incoming[i] ?? 0) === 0) {
      layer[i] = 0;
      queue.push(i);
    }
  }
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (const e of edges) {
      if (idIndex[e.from] !== i) continue;
      const ti = idIndex[e.to];
      if (ti == null) continue;
      const newLayer = (layer[i] ?? 0) + 1;
      if (newLayer > (layer[ti] ?? -1)) layer[ti] = newLayer;
      incoming[ti] = (incoming[ti] ?? 1) - 1;
      if ((incoming[ti] ?? 0) === 0) queue.push(ti);
    }
  }
  // Any node still at -1 is in a cycle — place it after the deepest assigned layer.
  let maxLayer = 0;
  for (const l of layer) if (l > maxLayer) maxLayer = l;
  for (let i = 0; i < layer.length; i += 1) {
    if ((layer[i] ?? -1) < 0) {
      maxLayer += 1;
      layer[i] = maxLayer;
    }
  }

  // Group node indices by layer to compute (col, row).
  const byLayer: Record<number, number[]> = {};
  for (let i = 0; i < nodes.length; i += 1) {
    const l = layer[i] ?? 0;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l]!.push(i);
  }

  const NODE_W = 140;
  const NODE_H = 44;
  const COL_GAP = 60;
  const ROW_GAP = 24;
  const PAD = 20;

  // Compute positions.
  const pos: Array<{ x: number; y: number }> = nodes.map(() => ({ x: 0, y: 0 }));
  const layerKeys = Object.keys(byLayer)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);
  let svgWidth = PAD * 2;
  let svgHeight = PAD * 2;
  for (const lyr of layerKeys) {
    const col = layerKeys.indexOf(lyr);
    const x = PAD + col * (NODE_W + COL_GAP);
    const ids = byLayer[lyr] ?? [];
    ids.forEach((nIdx, rowIdx) => {
      const y = PAD + rowIdx * (NODE_H + ROW_GAP);
      pos[nIdx] = { x, y };
      if (x + NODE_W + PAD > svgWidth) svgWidth = x + NODE_W + PAD;
      if (y + NODE_H + PAD > svgHeight) svgHeight = y + NODE_H + PAD;
    });
  }
  if (svgHeight < 200) svgHeight = 200;

  const markerId = `arrow-${id}`;

  // Build node + edge SVG fragments.
  const nodeSvg = nodes
    .map((n, i) => {
      const p = pos[i] ?? { x: 0, y: 0 };
      const cx = p.x + NODE_W / 2;
      const cy = p.y + NODE_H / 2 + 4; // baseline tweak
      return [
        `      <g class="pathway-node" data-node-id="${escapeHtml(n.id)}">`,
        `        <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="6" ry="6"></rect>`,
        `        <text x="${cx}" y="${cy}" text-anchor="middle">${escapeHtml(n.label ?? n.id)}</text>`,
        `      </g>`,
      ].join('\n');
    })
    .join('\n');

  const edgeSvg = edges
    .map((e) => {
      const fi = idIndex[e.from];
      const ti = idIndex[e.to];
      if (fi == null || ti == null) return '';
      const fp = pos[fi] ?? { x: 0, y: 0 };
      const tp = pos[ti] ?? { x: 0, y: 0 };
      const x1 = fp.x + NODE_W;
      const y1 = fp.y + NODE_H / 2;
      const x2 = tp.x;
      const y2 = tp.y + NODE_H / 2;
      const labelSvg = e.label
        ? `        <text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle">${escapeHtml(e.label)}</text>`
        : '';
      return [
        `      <g class="pathway-edge">`,
        `        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${markerId})"></line>`,
        labelSvg,
        `      </g>`,
      ]
        .filter((s) => s.length > 0)
        .join('\n');
    })
    .join('\n');

  return [
    `<div class="pathway-diagram" id="${id}" data-widget="pathway-diagram" data-renderer="d3-custom">`,
    `  <svg class="pathway-svg" width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" height="${svgHeight}">`,
    `    <defs>`,
    `      <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">`,
    `        <path d="M 0 0 L 10 5 L 0 10 z"></path>`,
    `      </marker>`,
    `    </defs>`,
    `    <g class="pathway-edges">`,
    edgeSvg,
    `    </g>`,
    `    <g class="pathway-nodes">`,
    nodeSvg,
    `    </g>`,
    `  </svg>`,
    legendHtml,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

registerRenderer('pathway-diagram', (widget) =>
  renderPathwayDiagram(widget as PathwayDiagramWidget),
);

/** Narrowed shape for the slider-estimation widget (T101, US4 — code).
 *
 * Contract: `SliderEstimationWidgetSchema` defines
 * `{ type, question, correctValue, acceptableRange, unit, variants }` where
 * `acceptableRange` is a single tolerance number (the half-width of the
 * accepted band — answer is correct if |user - correctValue| <= acceptableRange).
 *
 * The renderer brief also references optional alternative shape variants —
 * `acceptableRange: [low, high]` tuple, explicit `tolerance`, `min`, `max`,
 * `step`, and `explanation` — that may appear on future schema revisions or
 * already on widgets emitted by the LLM. We carry those as optional structural
 * fields so the renderer can prefer richer shapes when available without
 * breaking against the current Zod schema.
 */
type SliderEstimationWidget = Extract<WidgetSpec, { type: 'slider-estimation' }> & {
  tolerance?: number;
  min?: number;
  max?: number;
  step?: number;
  explanation?: string;
};

/**
 * Renderer for `slider-estimation` widgets (T101, US4).
 *
 * Emits a self-contained HTML fragment:
 *   - A `<input type="range">` slider whose value the learner adjusts to
 *     estimate the correct quantity.
 *   - Live `<output>` showing the current value + unit.
 *   - "Check" button that compares the user's value against the spec's
 *     `correctValue` ± tolerance band, reveals the actual value, the
 *     acceptable range, and (when present) an explanation, then locks
 *     the slider + button.
 *
 * Tolerance derivation (handles both schema variants):
 *   1. `acceptableRange` as `[low, high]` tuple → tolerance = (high - low) / 2
 *      (and the spec's `correctValue` should sit at the midpoint of the band).
 *   2. `acceptableRange` as a single number → that's the tolerance directly
 *      (the current Zod schema shape).
 *   3. Falls back to spec.tolerance if `acceptableRange` is missing.
 *
 * Range derivation (min/max/step): prefers explicit spec.min/spec.max/spec.step,
 * else widens the slider to `correctValue ± 2 * tolerance` so the correct
 * answer lives in the middle 50% of the slider's travel — gives the learner
 * room to be wrong on either side without making the band trivially obvious.
 */
export function renderSliderEstimation(spec: SliderEstimationWidget): string {
  const id = nextWidgetId('sl');
  const correctValue = Number(spec.correctValue);

  // Derive tolerance from whichever shape the spec uses.
  const ar: unknown = (spec as { acceptableRange?: unknown }).acceptableRange;
  let tolerance: number;
  if (Array.isArray(ar) && ar.length === 2 && typeof ar[0] === 'number' && typeof ar[1] === 'number') {
    tolerance = Math.abs((ar[1] - ar[0]) / 2);
  } else if (typeof ar === 'number') {
    tolerance = Math.abs(ar);
  } else if (typeof spec.tolerance === 'number') {
    tolerance = Math.abs(spec.tolerance);
  } else {
    // Last-ditch fallback — 10% of |correctValue|, or 1 if correctValue is 0.
    tolerance = Math.max(Math.abs(correctValue) * 0.1, 1);
  }

  // Derive slider bounds.
  const defaultSpan = Math.max(tolerance * 4, 1);
  const min = typeof spec.min === 'number' ? spec.min : correctValue - defaultSpan / 2 - tolerance;
  const max = typeof spec.max === 'number' ? spec.max : correctValue + defaultSpan / 2 + tolerance;
  // Sensible default step: 1/100 of the slider span, snapped to a clean increment.
  const span = max - min;
  const rawStep = typeof spec.step === 'number' ? spec.step : span / 100;
  // If the rawStep is sub-integer but correctValue looks integer, prefer 1.
  const step = rawStep > 0 ? rawStep : 1;

  const initialValue = min + (max - min) / 2;
  const unit = spec.unit ?? '';
  const unitHtml = escapeHtml(unit);
  const questionHtml = escapeHtml(spec.question ?? '');
  const explanationHtml = escapeHtml(spec.explanation ?? '');
  const lowBand = correctValue - tolerance;
  const highBand = correctValue + tolerance;

  // Format numbers with up to 4 decimal places, stripping trailing zeros.
  const fmt = (n: number): string => {
    if (!isFinite(n)) return String(n);
    const s = n.toFixed(4);
    return s.replace(/\.?0+$/, '') || '0';
  };

  return [
    `<div class="slider-estimation" id="${id}" data-widget="slider-estimation"`,
    `     data-correct-value="${correctValue}" data-tolerance="${tolerance}">`,
    `  <p class="question">${questionHtml}</p>`,
    `  <div class="slider-controls">`,
    `    <input type="range" class="value-slider" min="${fmt(min)}" max="${fmt(max)}" step="${fmt(step)}" value="${fmt(initialValue)}">`,
    `    <output class="slider-output">${fmt(initialValue)}${unit ? ' ' + unitHtml : ''}</output>`,
    `  </div>`,
    `  <button type="button" class="check-button" data-action="check">Check</button>`,
    `  <div class="feedback" hidden>`,
    `    <div class="result"></div>`,
    `    <div class="actual">Actual value: <strong>${fmt(correctValue)}${unit ? ' ' + unitHtml : ''}</strong></div>`,
    `    <div class="acceptable-range">Acceptable range: ${fmt(lowBand)} to ${fmt(highBand)}${unit ? ' ' + unitHtml : ''}</div>`,
    explanationHtml ? `    <p class="explanation">${explanationHtml}</p>` : '',
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var slider = root.querySelector('.value-slider');`,
    `    var output = root.querySelector('.slider-output');`,
    `    var btn = root.querySelector('[data-action="check"]');`,
    `    var feedback = root.querySelector('.feedback');`,
    `    var result = root.querySelector('.result');`,
    `    var unit = ${JSON.stringify(unit)};`,
    `    var correctValue = parseFloat(root.getAttribute('data-correct-value'));`,
    `    var tolerance = parseFloat(root.getAttribute('data-tolerance'));`,
    `    function formatNum(n){`,
    `      if (!isFinite(n)) return String(n);`,
    `      var s = n.toFixed(4);`,
    `      return s.replace(/\\.?0+$/, '') || '0';`,
    `    }`,
    `    slider.addEventListener('input', function(){`,
    `      output.textContent = formatNum(parseFloat(slider.value)) + (unit ? ' ' + unit : '');`,
    `    });`,
    `    btn.addEventListener('click', function(){`,
    `      var userValue = parseFloat(slider.value);`,
    `      var diff = Math.abs(userValue - correctValue);`,
    `      var pct = correctValue !== 0 ? (diff / Math.abs(correctValue)) * 100 : diff;`,
    `      if (diff <= tolerance) {`,
    `        root.classList.add('correct');`,
    `        result.textContent = 'Correct — within ' + formatNum(pct) + '% of the actual value.';`,
    `        result.className = 'result correct';`,
    `      } else {`,
    `        root.classList.add('incorrect');`,
    `        result.textContent = 'Off by ' + formatNum(diff) + (unit ? ' ' + unit : '') + ' (' + formatNum(pct) + '% from the actual value).';`,
    `        result.className = 'result incorrect';`,
    `      }`,
    `      feedback.hidden = false;`,
    `      slider.disabled = true;`,
    `      btn.disabled = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

registerRenderer('slider-estimation', (widget) =>
  renderSliderEstimation(widget as SliderEstimationWidget),
);

/**
 * Narrowed shape for the forest-plot widget (T102, US4 — medicine).
 *
 * Contract gap: `ForestPlotWidgetSchema` (as of T102) defines only
 * `{ type, studies: [{ label, effect, ci }] }`. The renderer brief and the
 * T107 test validators expect a richer payload — `pooledEffect`, `pooledCi`,
 * `effectMetric` (OR/RR/HR/MD), `modelType` (fixed/random),
 * `heterogeneityI2`, `heterogeneityP`, optional per-study `weight`/`n`,
 * plus optional `title` and `explanation`. We carry those as optional
 * structural fields (intersection) until a schema PR tightens the Zod
 * definition. Greppable test attributes (`data-pooled-hr`, `data-i2`,
 * `class="forest-plot"`, `class="forest-plot-row"`) are emitted regardless.
 */
type ForestPlotWidget = Extract<WidgetSpec, { type: 'forest-plot' }> & {
  title?: string;
  explanation?: string;
  pooledEffect?: number;
  pooledCi?: [number, number];
  effectMetric?: 'OR' | 'RR' | 'HR' | 'MD' | string;
  modelType?: 'fixed' | 'random' | string;
  heterogeneityI2?: number;
  heterogeneityP?: number;
  studies: Array<{
    label: string;
    effect: number;
    ci: [number, number];
    weight?: number;
    n?: number;
  }>;
};

/**
 * Renderer for `forest-plot` widgets (T102, US4 — medicine meta-analysis).
 *
 * Emits:
 *   - <div class="forest-plot" data-pooled-hr=... data-i2=...> wrapper with
 *     greppable attributes the T107 validators rely on.
 *   - An SVG container (`#fp-<id>`) that the vendored window.ForestPlot lib
 *     populates client-side. The vendor lib lives at
 *     `skill/shell/vendor/forest-plot/forest-plot.js` (T010).
 *   - A <table class="forest-data" hidden> textual fallback. Each per-study
 *     row carries `class="forest-plot-row"` for greppable counting; the
 *     pooled row uses `class="forest-pooled"`.
 *   - An inline IIFE that:
 *       1. waits up to ~2s for `window.ForestPlot` to load,
 *       2. calls `window.ForestPlot.render(selector, opts)` if found,
 *       3. falls back by un-hiding the data table if the lib never appears
 *          (graceful degradation per task brief),
 *       4. wires the "Show data table" toggle button.
 *
 * Numeric formatting follows the brief: effects + CI bounds → 2 decimals,
 * weights → 1 decimal, I² → integer. CI bounds rendered with an en-dash.
 */
export function renderForestPlot(spec: ForestPlotWidget): string {
  const id = nextWidgetId('fp');
  const containerId = `fp-${id}`;
  const studies = Array.isArray(spec.studies) ? spec.studies : [];

  const fmt2 = (n: number | undefined): string =>
    typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '';
  const fmt1 = (n: number | undefined): string =>
    typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '';
  const fmtInt = (n: number | undefined): string =>
    typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n)) : '';
  const fmtCi = (ci: [number, number] | undefined): string =>
    Array.isArray(ci) && ci.length === 2 ? `${fmt2(ci[0])}–${fmt2(ci[1])}` : '';

  const effectMetric = spec.effectMetric ?? 'Effect';
  const modelType = spec.modelType ?? 'random';
  const pooledEffect = typeof spec.pooledEffect === 'number' ? spec.pooledEffect : NaN;
  const pooledCi = spec.pooledCi;
  const i2 = spec.heterogeneityI2;
  const i2P = spec.heterogeneityP;

  const totalN = studies.reduce(
    (acc, s) => acc + (typeof s.n === 'number' && Number.isFinite(s.n) ? s.n : 0),
    0,
  );

  const titleHtml = spec.title
    ? `  <h3 class="forest-title">${escapeHtml(spec.title)}</h3>`
    : '';

  const studyRows = studies
    .map((s) => {
      const weightPct =
        typeof s.weight === 'number' && Number.isFinite(s.weight)
          ? `${fmt1(s.weight)}%`
          : '';
      const nDisplay = typeof s.n === 'number' && Number.isFinite(s.n) ? String(s.n) : '';
      return (
        `      <tr class="forest-plot-row" data-label="${escapeHtml(s.label)}">` +
        `<td>${escapeHtml(s.label)}</td>` +
        `<td>${fmt2(s.effect)}</td>` +
        `<td>${fmtCi(s.ci)}</td>` +
        `<td>${weightPct}</td>` +
        `<td>${nDisplay}</td>` +
        `</tr>`
      );
    })
    .join('\n');

  const pooledRow =
    `      <tr class="forest-pooled" data-pooled="true">` +
    `<td><strong>Pooled (${escapeHtml(modelType)})</strong></td>` +
    `<td>${fmt2(pooledEffect)}</td>` +
    `<td>${fmtCi(pooledCi)}</td>` +
    `<td>100%</td>` +
    `<td>${totalN > 0 ? String(totalN) : ''}</td>` +
    `</tr>`;

  const explanationHtml = spec.explanation
    ? `  <p class="explanation">${escapeHtml(spec.explanation)}</p>`
    : '';

  // Build the JS payload for window.ForestPlot.render(...).
  const logScale = ['OR', 'RR', 'HR'].includes(String(effectMetric));
  const renderOpts: Record<string, unknown> = {
    studies: studies.map((s) => ({
      label: s.label,
      effect: s.effect,
      ci: s.ci,
      weight: s.weight,
      n: s.n,
    })),
    effectMetric,
    effectLabel: effectMetric,
    logScale,
    modelType,
  };
  if (typeof pooledEffect === 'number' && Number.isFinite(pooledEffect) && pooledCi) {
    renderOpts.pooled = { effect: pooledEffect, ci: pooledCi };
    // Vendor mini-lib accepts `summary` as the diamond payload.
    renderOpts.summary = { effect: pooledEffect, ci: pooledCi };
  }
  if (spec.title) renderOpts.title = spec.title;

  const renderOptsJson = JSON.stringify(renderOpts);
  const containerIdJson = JSON.stringify(containerId);

  // Wrapper data attributes — must match exactly for T107 test validators.
  const dataAttrs = [
    `class="forest-plot"`,
    `data-section="forest-plot"`,
    `data-widget="forest-plot"`,
    `data-pooled-hr="${escapeHtml(fmt2(pooledEffect))}"`,
    `data-effect-metric="${escapeHtml(String(effectMetric))}"`,
    `data-model-type="${escapeHtml(String(modelType))}"`,
    `data-i2="${escapeHtml(fmtInt(i2))}"`,
    `data-i2-p="${escapeHtml(fmt2(i2P))}"`,
  ].join(' ');

  const i2Display = typeof i2 === 'number' ? `I² = ${fmtInt(i2)}%` : '';
  const i2PDisplay = typeof i2P === 'number' ? `p = ${fmt2(i2P)}` : '';

  return [
    `<div ${dataAttrs}>`,
    titleHtml,
    `  <div class="forest-svg-container" id="${containerId}"></div>`,
    `  <table class="forest-data" hidden>`,
    `    <thead><tr><th>Study</th><th>${escapeHtml(String(effectMetric))}</th><th>95% CI</th><th>Weight</th><th>N</th></tr></thead>`,
    `    <tbody>`,
    studyRows,
    pooledRow,
    `    </tbody>`,
    `  </table>`,
    `  <div class="forest-meta">`,
    `    <span class="i2">${i2Display}</span>`,
    `    <span class="i2-p">${i2PDisplay}</span>`,
    `  </div>`,
    `  <button type="button" class="data-toggle" data-action="toggle-data">Show data table</button>`,
    explanationHtml,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${containerIdJson});`,
    `    if (!root) return;`,
    `    var wrapper = root.closest('.forest-plot');`,
    `    var table = wrapper ? wrapper.querySelector('.forest-data') : null;`,
    `    var toggle = wrapper ? wrapper.querySelector('[data-action="toggle-data"]') : null;`,
    `    var opts = ${renderOptsJson};`,
    `    var attempts = 0;`,
    `    var maxAttempts = 40; // ~2s at 50ms intervals`,
    `    function tryRender(){`,
    `      attempts++;`,
    `      var lib = (typeof window !== 'undefined') ? window.ForestPlot : null;`,
    `      if (lib && (typeof lib.render === 'function' || typeof lib.renderForestPlot === 'function')) {`,
    `        try {`,
    `          var fn = (typeof lib.render === 'function') ? lib.render : lib.renderForestPlot;`,
    `          fn(root, opts);`,
    `        } catch(e) {`,
    `          if (table) table.hidden = false;`,
    `        }`,
    `        return;`,
    `      }`,
    `      if (attempts >= maxAttempts) {`,
    `        // Fallback: vendor lib never loaded — show the data table inline.`,
    `        if (table) table.hidden = false;`,
    `        if (toggle) toggle.hidden = true;`,
    `        return;`,
    `      }`,
    `      setTimeout(tryRender, 50);`,
    `    }`,
    `    if (typeof document !== 'undefined' && document.readyState === 'loading') {`,
    `      document.addEventListener('DOMContentLoaded', tryRender);`,
    `    } else {`,
    `      tryRender();`,
    `    }`,
    `    if (toggle && table) {`,
    `      toggle.addEventListener('click', function(){`,
    `        var nowHidden = !table.hidden;`,
    `        table.hidden = nowHidden;`,
    `        toggle.textContent = nowHidden ? 'Show data table' : 'Hide data table';`,
    `      });`,
    `    }`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

registerRenderer('forest-plot', (widget) =>
  renderForestPlot(widget as ForestPlotWidget),
);

/** List the kinds currently registered. Useful for sanity tests. */
export function registeredKinds(): WidgetKind[] {
  return Array.from(REGISTRY.keys());
}

// ---------------------------------------------------------------------------
// T182 — Register 9 missing renderers (mcq, true-false, mathjax, mermaid,
// chemical-reaction, molecule-2d, confidence-weighted, boss, reactive-math)
// so plain `mcq` and other common widget kinds don't throw NotImplemented.
// ---------------------------------------------------------------------------

type McqWidget = Extract<WidgetSpec, { type: 'mcq' }>;
type TrueFalseWidget = Extract<WidgetSpec, { type: 'true-false' }>;
type MathjaxWidget = Extract<WidgetSpec, { type: 'mathjax' }>;
type MermaidWidget = Extract<WidgetSpec, { type: 'mermaid' }>;
type ChemicalReactionWidget = Extract<WidgetSpec, { type: 'chemical-reaction' }>;
type Molecule2dWidget = Extract<WidgetSpec, { type: 'molecule-2d' }>;
type ConfidenceWeightedWidget = Extract<WidgetSpec, { type: 'confidence-weighted' }>;
type BossWidget = Extract<WidgetSpec, { type: 'boss' }>;
type ReactiveMathWidget = Extract<WidgetSpec, { type: 'reactive-math' }>;

/**
 * Plain MCQ — simpler cousin of mcq-clinical-vignette. 2-5 options, single
 * correct, per-option explanation revealed on Check.
 *
 * Contract gap: `McqWidgetSchema` has no top-level `explanation` — overall
 * rationale is encoded via per-option `explanation` strings only.
 */
export function renderMcq(spec: McqWidget): string {
  const id = nextWidgetId('mcq');
  const stem = spec.stem ?? '';
  const options = spec.options ?? [];

  const letters = ['A', 'B', 'C', 'D', 'E'];
  const optionsHtml = options
    .map((opt, idx) => {
      const letter = letters[idx] ?? String(idx + 1);
      const correct = opt.correct === true ? 'true' : 'false';
      return [
        `      <li class="option" data-correct="${correct}" data-option-letter="${letter}" data-option-index="${idx}">`,
        `        <label class="option-label">`,
        `          <input type="radio" name="${id}-opt" value="${idx}" />`,
        `          <span class="option-letter">${letter}.</span>`,
        `          <span class="option-text">${escapeHtml(opt.label ?? '')}</span>`,
        `        </label>`,
        `        <div class="explanation" hidden>${escapeHtml(opt.explanation ?? '')}</div>`,
        `      </li>`,
      ].join('\n');
    })
    .join('\n');

  return [
    `<div class="mcq" id="${id}" data-widget="mcq">`,
    `  <div class="stem">${escapeHtml(stem)}</div>`,
    `  <ol class="options" type="A">`,
    optionsHtml,
    `  </ol>`,
    `  <div class="mcq-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="mcq-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var btn = root.querySelector('button[data-action="check"]');`,
    `    var feedback = root.querySelector('.mcq-feedback');`,
    `    btn.addEventListener('click', function(){`,
    `      var sel = root.querySelector('input[type="radio"]:checked');`,
    `      var opts = root.querySelectorAll('.option');`,
    `      opts.forEach(function(li){`,
    `        var exp = li.querySelector('.explanation');`,
    `        if (exp) exp.hidden = false;`,
    `        if (li.getAttribute('data-correct') === 'true') li.classList.add('correct');`,
    `      });`,
    `      var ok = sel && sel.closest('.option').getAttribute('data-correct') === 'true';`,
    `      if (sel) sel.closest('.option').classList.add(ok ? 'selected-correct' : 'selected-wrong');`,
    `      feedback.textContent = ok ? 'Correct.' : 'Incorrect.';`,
    `      feedback.className = 'mcq-feedback ' + (ok ? 'correct' : 'incorrect');`,
    `      root.querySelectorAll('input[type="radio"]').forEach(function(i){ i.disabled = true; });`,
    `      btn.disabled = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/** True/False renderer — single statement, two radio options, reveals on check. */
export function renderTrueFalse(spec: TrueFalseWidget): string {
  const id = nextWidgetId('tf');
  const statement = spec.statement ?? '';
  const correct = spec.correct === true;
  const explanation = spec.explanation ?? '';

  return [
    `<div class="true-false" id="${id}" data-widget="true-false" data-correct="${correct}">`,
    `  <p class="statement">${escapeHtml(statement)}</p>`,
    `  <div class="tf-options">`,
    `    <label><input type="radio" name="${id}-tf" value="true" /> True</label>`,
    `    <label><input type="radio" name="${id}-tf" value="false" /> False</label>`,
    `  </div>`,
    `  <div class="tf-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="tf-feedback" role="status" aria-live="polite"></span>`,
    `  </div>`,
    `  <div class="explanation" hidden>${escapeHtml(explanation)}</div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var correct = root.getAttribute('data-correct') === 'true';`,
    `    var btn = root.querySelector('button[data-action="check"]');`,
    `    var feedback = root.querySelector('.tf-feedback');`,
    `    var exp = root.querySelector('.explanation');`,
    `    btn.addEventListener('click', function(){`,
    `      var sel = root.querySelector('input[type="radio"]:checked');`,
    `      if (!sel) { feedback.textContent = 'Pick True or False.'; return; }`,
    `      var ok = (sel.value === 'true') === correct;`,
    `      feedback.textContent = ok ? 'Correct.' : 'Incorrect — answer was ' + (correct ? 'True' : 'False') + '.';`,
    `      feedback.className = 'tf-feedback ' + (ok ? 'correct' : 'incorrect');`,
    `      if (exp) exp.hidden = false;`,
    `      root.querySelectorAll('input[type="radio"]').forEach(function(i){ i.disabled = true; });`,
    `      btn.disabled = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/** MathJax — emits a wrapped equation div + a typeset call. */
export function renderMathjax(spec: MathjaxWidget): string {
  const id = nextWidgetId('mjx');
  const source = spec.source ?? '';
  return [
    `<div class="mathjax" id="${id}" data-widget="mathjax">${escapeHtml(source)}</div>`,
    `<script>`,
    `(function(){`,
    `  function typeset(){`,
    `    var el = document.getElementById(${JSON.stringify(id)});`,
    `    if (!el) return;`,
    `    if (window.MathJax && window.MathJax.typesetPromise) {`,
    `      window.MathJax.typesetPromise([el]).catch(function(){});`,
    `    }`,
    `  }`,
    `  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', typeset);`,
    `  else typeset();`,
    `})();`,
    `</script>`,
  ].join('\n');
}

/** Mermaid — emits the mermaid div + lazy init. */
export function renderMermaid(spec: MermaidWidget): string {
  const id = nextWidgetId('mmd');
  const source = spec.source ?? '';
  return [
    `<div class="mermaid" id="${id}" data-widget="mermaid">${escapeHtml(source)}</div>`,
    `<script>`,
    `(function(){`,
    `  function run(){`,
    `    if (!window.mermaid) return;`,
    `    try {`,
    `      if (!window.__chironMermaidInit) {`,
    `        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });`,
    `        window.__chironMermaidInit = true;`,
    `      }`,
    `      var el = document.getElementById(${JSON.stringify(id)});`,
    `      if (el && window.mermaid.run) window.mermaid.run({ nodes: [el] });`,
    `    } catch(e) { /* mermaid render failed — leave source visible */ }`,
    `  }`,
    `  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);`,
    `  else run();`,
    `})();`,
    `</script>`,
  ].join('\n');
}

/**
 * Chemical reaction — uses MathJax + mhchem extension to render the equation.
 * Prefers `mhchemNotation` (e.g. `\\ce{H2O + CO2 -> H2CO3}`); falls back to
 * `equation` if not supplied. Wrapped in `\\(...\\)` for inline MathJax.
 */
export function renderChemicalReaction(spec: ChemicalReactionWidget): string {
  const id = nextWidgetId('cr');
  const notation = spec.mhchemNotation ?? spec.equation ?? '';
  const explanation = spec.explanation ?? '';
  return [
    `<div class="chemical-reaction" id="${id}" data-widget="chemical-reaction">`,
    `  <span class="mhchem">\\(${escapeHtml(notation)}\\)</span>`,
    explanation ? `  <p class="explanation">${escapeHtml(explanation)}</p>` : '',
    `  <script>`,
    `  (function(){`,
    `    var el = document.getElementById(${JSON.stringify(id)});`,
    `    if (!el) return;`,
    `    if (window.MathJax && window.MathJax.typesetPromise) {`,
    `      window.MathJax.typesetPromise([el]).catch(function(){});`,
    `    }`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

/**
 * 2D molecule — lazy-loads `chemistry-renderer.js` (which exports
 * `getMoleculeRenderer()` returning a Kekule.js or RDKit-JS adapter — concrete
 * choice deferred per FR-031) and renders the SMILES string into the container.
 *
 * Contract gap: `Molecule2dWidgetSchema` requires `smiles`; we still guard
 * against empty strings in case generation produced a degenerate widget.
 */
export function renderMolecule2d(spec: Molecule2dWidget): string {
  const id = nextWidgetId('mol');
  const smiles = spec.smiles ?? '';
  const explanation = spec.explanation ?? '';

  if (!smiles) {
    return [
      `<div class="molecule-2d molecule-2d-empty" id="${id}" data-widget="molecule-2d">`,
      `  <p class="molecule-fallback">Molecule structure not available.</p>`,
      explanation ? `  <p class="explanation">${escapeHtml(explanation)}</p>` : '',
      `</div>`,
    ]
      .filter((s) => s.length > 0)
      .join('\n');
  }

  return [
    `<div class="molecule-2d" id="${id}" data-widget="molecule-2d" data-smiles="${escapeHtml(smiles)}">`,
    `  <div class="molecule-svg-container"></div>`,
    explanation ? `  <p class="explanation">${escapeHtml(explanation)}</p>` : '',
    `  <script type="module">`,
    `  (async function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var container = root.querySelector('.molecule-svg-container');`,
    `    var smiles = root.getAttribute('data-smiles') || '';`,
    `    try {`,
    `      var mod = await import('./chemistry-renderer.js');`,
    `      var renderer = (mod.getMoleculeRenderer ? mod.getMoleculeRenderer() : (mod.default && mod.default.getMoleculeRenderer && mod.default.getMoleculeRenderer()));`,
    `      if (renderer && renderer.render) {`,
    `        await renderer.render(smiles, container);`,
    `      } else {`,
    `        container.textContent = 'Molecule renderer unavailable.';`,
    `      }`,
    `    } catch(e) {`,
    `      container.textContent = 'Failed to render molecule: ' + (e && e.message ? e.message : 'unknown error');`,
    `    }`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

/**
 * Confidence-weighted MCQ — pick an answer AND a confidence percentage (0-100).
 * Brier-style scoring: score = correct ? +confidence : -confidence. Encourages
 * calibrated metacognition.
 *
 * Contract gap: `ConfidenceWeightedWidgetSchema.mcq` has no per-option `correct`
 * required; we read it where present and fall back to "no correct answer
 * specified" if all options are unmarked.
 */
export function renderConfidenceWeighted(spec: ConfidenceWeightedWidget): string {
  const id = nextWidgetId('cw');
  const stem = spec.mcq?.stem ?? '';
  const options = spec.mcq?.options ?? [];

  const letters = ['A', 'B', 'C', 'D', 'E'];
  const optionsHtml = options
    .map((opt, idx) => {
      const letter = letters[idx] ?? String(idx + 1);
      const correct = opt.correct === true ? 'true' : 'false';
      return [
        `      <li class="option" data-correct="${correct}" data-option-index="${idx}">`,
        `        <label class="option-label">`,
        `          <input type="radio" name="${id}-opt" value="${idx}" />`,
        `          <span class="option-letter">${letter}.</span>`,
        `          <span class="option-text">${escapeHtml(opt.label ?? '')}</span>`,
        `        </label>`,
        `        <div class="explanation" hidden>${escapeHtml(opt.explanation ?? '')}</div>`,
        `      </li>`,
      ].join('\n');
    })
    .join('\n');

  return [
    `<div class="confidence-weighted" id="${id}" data-widget="confidence-weighted">`,
    `  <div class="stem">${escapeHtml(stem)}</div>`,
    `  <ol class="options" type="A">`,
    optionsHtml,
    `  </ol>`,
    `  <div class="confidence-row">`,
    `    <label for="${id}-conf">Confidence: <span class="confidence-value">50</span>%</label>`,
    `    <input type="range" id="${id}-conf" class="confidence-slider" min="0" max="100" step="1" value="50" />`,
    `  </div>`,
    `  <div class="cw-controls">`,
    `    <button type="button" class="check-button" data-action="check">Check</button>`,
    `    <span class="cw-feedback" role="status" aria-live="polite"></span>`,
    `    <span class="cw-score" data-score=""></span>`,
    `  </div>`,
    `  <script>`,
    `  (function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    var slider = root.querySelector('.confidence-slider');`,
    `    var valEl = root.querySelector('.confidence-value');`,
    `    var btn = root.querySelector('button[data-action="check"]');`,
    `    var feedback = root.querySelector('.cw-feedback');`,
    `    var scoreEl = root.querySelector('.cw-score');`,
    `    slider.addEventListener('input', function(){ valEl.textContent = slider.value; });`,
    `    btn.addEventListener('click', function(){`,
    `      var sel = root.querySelector('input[type="radio"]:checked');`,
    `      if (!sel) { feedback.textContent = 'Pick an option first.'; return; }`,
    `      var conf = parseInt(slider.value, 10) || 0;`,
    `      var ok = sel.closest('.option').getAttribute('data-correct') === 'true';`,
    `      var score = ok ? conf : -conf;`,
    `      feedback.textContent = ok ? 'Correct.' : 'Incorrect.';`,
    `      feedback.className = 'cw-feedback ' + (ok ? 'correct' : 'incorrect');`,
    `      scoreEl.textContent = '  Score: ' + (score > 0 ? '+' : '') + score;`,
    `      scoreEl.setAttribute('data-score', String(score));`,
    `      root.querySelectorAll('.option .explanation').forEach(function(e){ e.hidden = false; });`,
    `      root.querySelectorAll('input[type="radio"]').forEach(function(i){ i.disabled = true; });`,
    `      slider.disabled = true;`,
    `      btn.disabled = true;`,
    `    });`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

/**
 * Boss widget — large compound multi-stage challenge. Schema currently only
 * exposes `{ question, requiredConcepts[], rubric }`; sub-widget composition
 * is not yet defined. Emit a stub framing the challenge so it does not throw,
 * with `data-boss-stage="pending"` for later wave to upgrade.
 *
 * Contract gap: `BossWidgetSchema` lacks any sub-widget array — the
 * "compound multi-stage" notion lives in the brief, not the schema. Tightening
 * deferred to a future wave that defines the stage shape.
 */
export function renderBoss(spec: BossWidget): string {
  const id = nextWidgetId('boss');
  const question = spec.question ?? '';
  const required = spec.requiredConcepts ?? [];
  const rubric = spec.rubric ?? '';

  const conceptChips = required
    .map((c) => `<span class="boss-concept-chip">${escapeHtml(String(c))}</span>`)
    .join('\n        ');

  return [
    `<div class="boss" id="${id}" data-widget="boss" data-boss-stage="pending">`,
    `  <div class="boss-banner">Boss Challenge</div>`,
    `  <div class="boss-question">${escapeHtml(question)}</div>`,
    required.length > 0 ? `  <div class="boss-required-concepts">\n    <strong>Required concepts:</strong>\n    <div class="boss-chips">\n        ${conceptChips}\n    </div>\n  </div>` : '',
    rubric ? `  <details class="boss-rubric"><summary>Rubric</summary><p>${escapeHtml(rubric)}</p></details>` : '',
    `  <p class="boss-pending-note"><em>Boss challenge — implementation pending.</em></p>`,
    `</div>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

/**
 * Reactive math — uses the ChalkAI lazy loader (T039) to mount a reactive
 * widget defined by `chalkDsl`. The loader stub displays a placeholder until
 * the real ChalkAI bundle is wired up.
 */
export function renderReactiveMath(spec: ReactiveMathWidget): string {
  const id = nextWidgetId('rxm');
  const dsl = spec.chalkDsl ?? '';
  // Embed DSL as JSON-string in a data attribute; ChalkAI runtime will parse it.
  const specJson = JSON.stringify({ chalkDsl: dsl });
  return [
    `<div class="reactive-math" id="${id}" data-widget="reactive-math" data-spec='${escapeHtml(specJson)}'>`,
    `  <p class="reactive-math-loading">Loading reactive widget…</p>`,
    `  <script type="module">`,
    `  (async function(){`,
    `    var root = document.getElementById(${JSON.stringify(id)});`,
    `    if (!root) return;`,
    `    try {`,
    `      var mod = await import('./chalkai-loader.js');`,
    `      var loadChalkAI = mod.loadChalkAI || (mod.default && mod.default.loadChalkAI);`,
    `      if (!loadChalkAI) { root.querySelector('.reactive-math-loading').textContent = 'ChalkAI loader unavailable.'; return; }`,
    `      var rt = await loadChalkAI();`,
    `      var raw = root.getAttribute('data-spec') || '{}';`,
    `      var spec = JSON.parse(raw);`,
    `      if (rt && rt.mount) { rt.mount(root, spec); }`,
    `    } catch(e) {`,
    `      var msg = root.querySelector('.reactive-math-loading');`,
    `      if (msg) msg.textContent = 'Reactive widget failed to load: ' + (e && e.message ? e.message : 'unknown error');`,
    `    }`,
    `  })();`,
    `  </script>`,
    `</div>`,
  ].join('\n');
}

// Registrations (alphabetical)
registerRenderer('boss', (widget) => renderBoss(widget as BossWidget));
registerRenderer('chemical-reaction', (widget) =>
  renderChemicalReaction(widget as ChemicalReactionWidget),
);
registerRenderer('confidence-weighted', (widget) =>
  renderConfidenceWeighted(widget as ConfidenceWeightedWidget),
);
registerRenderer('mathjax', (widget) => renderMathjax(widget as MathjaxWidget));
registerRenderer('mcq', (widget) => renderMcq(widget as McqWidget));
registerRenderer('mermaid', (widget) => renderMermaid(widget as MermaidWidget));
registerRenderer('molecule-2d', (widget) =>
  renderMolecule2d(widget as Molecule2dWidget),
);
registerRenderer('reactive-math', (widget) =>
  renderReactiveMath(widget as ReactiveMathWidget),
);
registerRenderer('true-false', (widget) =>
  renderTrueFalse(widget as TrueFalseWidget),
);

// ===========================================================================
// Universal engagement primitives (v1 — added 2026-05-23).
// Each renderer emits chiron-shell-compatible markup. Control buttons receive
// both their widget-JS hook class AND the `.btn` / `.btn-primary` style class
// (close the undocumented chiron-shell contract that bit us in v1 sandbox).
// ===========================================================================

type GroupChatAnimationWidget = Extract<WidgetSpec, { type: 'group-chat-animation' }>;
type FlowAnimationWidget = Extract<WidgetSpec, { type: 'flow-animation' }>;
type GlossaryTooltipsWidget = Extract<WidgetSpec, { type: 'glossary-tooltips' }>;
type PatternCardsWidget = Extract<WidgetSpec, { type: 'pattern-cards' }>;
type StepCardsWidget = Extract<WidgetSpec, { type: 'step-cards' }>;
type FileTreeWidget = Extract<WidgetSpec, { type: 'file-tree' }>;
type PermissionBadgeWidget = Extract<WidgetSpec, { type: 'permission-badge' }>;
type LayerToggleWidget = Extract<WidgetSpec, { type: 'layer-toggle' }>;
type WhyCareCalloutWidget = Extract<WidgetSpec, { type: 'why-care-callout' }>;
type CodeEnglishTranslationWidget = Extract<WidgetSpec, { type: 'code-english-translation' }>;

/** Default avatar color cycle (CSS variable references) — used when a chat
 *  message doesn't override avatarColorVar. Order: accent → info → warm. */
const AVATAR_COLOR_VARS = ['--chiron-accent', '--chiron-info', '--chiron-warm-accent', '--chiron-success'];

/** group-chat-animation. Chiron-shell engine drives Next / Skip / Reset. */
export function renderGroupChatAnimation(spec: GroupChatAnimationWidget): string {
  const id = spec.id || nextWidgetId('chat');
  const senderColors = new Map<string, string>();
  spec.messages.forEach((m) => {
    if (!senderColors.has(m.sender)) {
      const fallback = AVATAR_COLOR_VARS[senderColors.size % AVATAR_COLOR_VARS.length];
      senderColors.set(m.sender, m.avatarColorVar || fallback);
    }
  });
  const msgsHtml = spec.messages
    .map((m) => {
      const colorVar = m.avatarColorVar || senderColors.get(m.sender)!;
      return (
        `<div class="chat-message" data-sender="${escapeHtml(m.sender)}" style="display:none">` +
        `<div class="chat-avatar" style="background:var(${escapeHtml(colorVar)})">${escapeHtml(m.avatarChar)}</div>` +
        `<div class="chat-bubble">` +
        `<div class="chat-sender">${escapeHtml(m.senderLabel)}</div>` +
        `<p>${m.body}</p>` +
        `</div></div>`
      );
    })
    .join('');
  return (
    (spec.title ? `<h4>${escapeHtml(spec.title)}</h4>` : '') +
    (spec.framing ? `<p>${escapeHtml(spec.framing)}</p>` : '') +
    `<div class="chat-window" id="${id}">` +
    `<div class="chat-messages">${msgsHtml}</div>` +
    `<div class="chat-typing" style="display:none">` +
      `<div class="chat-avatar"></div>` +
      `<div class="chat-typing-dots"><span></span><span></span><span></span></div>` +
    `</div>` +
    `<div class="chat-controls">` +
      `<button class="btn btn-primary chat-next-btn">Next →</button>` +
      `<button class="btn chat-all-btn">Skip to end</button>` +
      `<button class="btn chat-reset-btn">Reset</button>` +
      `<span class="chat-progress">0 / ${spec.messages.length} messages</span>` +
    `</div></div>`
  );
}

/** flow-animation. Chiron-shell engine consumes the data-steps JSON. */
export function renderFlowAnimation(spec: FlowAnimationWidget): string {
  const id = spec.id || nextWidgetId('flow');
  const actorsHtml = spec.actors
    .map(
      (a) =>
        `<div class="flow-actor" id="flow-${escapeHtml(a.id)}">` +
        `<div class="flow-actor-icon">${escapeHtml(a.icon ?? '●')}</div>` +
        `<span>${escapeHtml(a.label)}</span>` +
        `</div>`,
    )
    .join('');
  const stepsJson = JSON.stringify(
    spec.steps.map((s) => ({
      label: s.label,
      ...(s.highlight ? { highlight: s.highlight } : {}),
      ...(s.packet ? { packet: true } : {}),
      ...(s.from ? { from: s.from } : {}),
      ...(s.to ? { to: s.to } : {}),
    })),
  ).replace(/"/g, '&quot;');
  return (
    (spec.title ? `<h4>${escapeHtml(spec.title)}</h4>` : '') +
    (spec.intro ? `<p>${escapeHtml(spec.intro)}</p>` : '') +
    `<div class="flow-animation" id="${id}" data-steps="${stepsJson}">` +
    `<div class="flow-actors">${actorsHtml}</div>` +
    `<div class="flow-packet"></div>` +
    `<div class="flow-step-label">Press Next to start.</div>` +
    `<div class="flow-controls">` +
      `<button class="btn btn-primary flow-next-btn">Next →</button>` +
      `<button class="btn flow-reset-btn">Reset</button>` +
      `<span class="flow-progress">Step 0 / ${spec.steps.length}</span>` +
    `</div></div>`
  );
}

/** glossary-tooltips. Emits a small index block + relies on shell's inline
 *  .term / .term-tooltip pattern. Stage 4 prose can use class="term"
 *  data-definition="..." inline; this widget provides the catalog. */
export function renderGlossaryTooltips(spec: GlossaryTooltipsWidget): string {
  const id = spec.id || nextWidgetId('gloss');
  const rows = spec.entries
    .map(
      (e) =>
        `<dt><span class="term" data-definition="${escapeHtml(e.definition)}">${escapeHtml(e.term)}</span></dt>` +
        `<dd>${escapeHtml(e.definition)}</dd>`,
    )
    .join('');
  return (
    `<aside class="glossary-block" id="${id}">` +
    `<h4>Glossary</h4>` +
    `<dl>${rows}</dl>` +
    `</aside>`
  );
}

/** pattern-cards. */
export function renderPatternCards(spec: PatternCardsWidget): string {
  const id = spec.id || nextWidgetId('pcards');
  const cards = spec.cards
    .map(
      (c) =>
        `<div class="pattern-card">` +
        (c.num ? `<span class="pc-num">${escapeHtml(c.num)}</span>` : '') +
        `<h4>${escapeHtml(c.title)}</h4>` +
        `<p class="pc-body">${escapeHtml(c.body)}</p>` +
        (c.foot ? `<div class="pc-foot">${escapeHtml(c.foot)}</div>` : '') +
        `</div>`,
    )
    .join('');
  return (
    (spec.title ? `<h3>${escapeHtml(spec.title)}</h3>` : '') +
    `<div class="pattern-cards" id="${id}">${cards}</div>`
  );
}

/** step-cards. */
export function renderStepCards(spec: StepCardsWidget): string {
  const id = spec.id || nextWidgetId('scards');
  const cards = spec.steps
    .map(
      (s) =>
        `<div class="sc">` +
        `<div class="sc-num">${s.n}</div>` +
        `<h5>${escapeHtml(s.label)}</h5>` +
        `<p>${escapeHtml(s.body)}</p>` +
        `</div>`,
    )
    .join('');
  return (
    (spec.title ? `<h3>${escapeHtml(spec.title)}</h3>` : '') +
    `<div class="step-cards" id="${id}">${cards}</div>`
  );
}

/** file-tree. */
export function renderFileTree(spec: FileTreeWidget): string {
  const id = spec.id || nextWidgetId('ftree');
  const lines = spec.lines
    .map((ln) => {
      const cls = `ft-line ft-l${ln.depth}${ln.highlight ? ' highlight' : ''}`;
      return (
        `<div class="${cls}">` +
        `<span class="ft-icon">${escapeHtml(ln.icon ?? '📁')}</span>` +
        `<span class="ft-name">${escapeHtml(ln.name)}</span>` +
        (ln.tag ? `<span class="ft-tag">${escapeHtml(ln.tag)}</span>` : '') +
        `</div>`
      );
    })
    .join('');
  return (
    (spec.title ? `<h4>${escapeHtml(spec.title)}</h4>` : '') +
    `<div class="filetree" id="${id}">${lines}</div>`
  );
}

/** permission-badge — atomic. */
export function renderPermissionBadge(spec: PermissionBadgeWidget): string {
  return `<span class="badge ${escapeHtml(spec.variant)}" id="${escapeHtml(spec.id || nextWidgetId('badge'))}">${escapeHtml(spec.label)}</span>`;
}

/** layer-toggle. Inline JS-free; relies on chiron-shell's binding on
 *  .lt-btn → setAttribute('data-axis-show', btn.dataset.show). */
export function renderLayerToggle(spec: LayerToggleWidget): string {
  const id = spec.id || nextWidgetId('lt');
  const buttons = spec.axes
    .map(
      (a) =>
        `<button class="btn lt-btn${a.key === spec.defaultShow ? ' active' : ''}" data-show="${escapeHtml(a.key)}" type="button">${escapeHtml(a.label)}</button>`,
    )
    .join('');
  const panels = spec.axes
    .map(
      (a) =>
        `<div class="lt-axis-${escapeHtml(a.key)}">` +
        `<b>${escapeHtml(a.title)}</b> — ${escapeHtml(a.body)}` +
        `</div>`,
    )
    .join('');
  // also add a "both" button
  const bothBtn = `<button class="btn lt-btn${spec.defaultShow === 'both' ? ' active' : ''}" data-show="both" type="button">Both</button>`;
  return (
    `<div class="layer-toggle" id="${id}" data-axis-show="${escapeHtml(spec.defaultShow)}">` +
    (spec.caption ? `<span class="lt-tag">${escapeHtml(spec.caption)}</span>` : '') +
    `<div class="lt-buttons">${buttons}${bothBtn}</div>` +
    panels +
    `</div>`
  );
}

/** why-care-callout. */
export function renderWhyCareCallout(spec: WhyCareCalloutWidget): string {
  return (
    `<div class="why-care" id="${escapeHtml(spec.id || nextWidgetId('whycare'))}">` +
    `<b>Why you care</b>` +
    `${escapeHtml(spec.body)}` +
    `</div>`
  );
}

/** code-english-translation. CODE-ONLY. Row-tinted pairing baked in via
 *  chiron-shell.css :nth-child(6n+N) selectors — no inline color logic. */
export function renderCodeEnglishTranslation(spec: CodeEnglishTranslationWidget): string {
  const id = spec.id || nextWidgetId('cet');
  const codeLines = spec.pairs
    .map((p) => `<div class="tl">${escapeHtml(p.code)}</div>`)
    .join('');
  const englishLines = spec.pairs
    .map((p) => `<div class="tl">${escapeHtml(p.english)}</div>`)
    .join('');
  return (
    `<div class="translation-block" id="${id}" data-language="${escapeHtml(spec.language)}">` +
    `<div class="translation-code">` +
      `<span class="translation-label">${escapeHtml(spec.codeLabel)}</span>` +
      `<div class="translation-lines">${codeLines}</div>` +
    `</div>` +
    `<div class="translation-english">` +
      `<span class="translation-label">${escapeHtml(spec.englishLabel)}</span>` +
      `<div class="translation-lines">${englishLines}</div>` +
    `</div>` +
    `</div>`
  );
}

// Register all 10 new renderers (overrides Wave-2 throwing stubs)
registerRenderer('group-chat-animation', (w) =>
  renderGroupChatAnimation(w as GroupChatAnimationWidget),
);
registerRenderer('flow-animation', (w) =>
  renderFlowAnimation(w as FlowAnimationWidget),
);
registerRenderer('glossary-tooltips', (w) =>
  renderGlossaryTooltips(w as GlossaryTooltipsWidget),
);
registerRenderer('pattern-cards', (w) =>
  renderPatternCards(w as PatternCardsWidget),
);
registerRenderer('step-cards', (w) =>
  renderStepCards(w as StepCardsWidget),
);
registerRenderer('file-tree', (w) =>
  renderFileTree(w as FileTreeWidget),
);
registerRenderer('permission-badge', (w) =>
  renderPermissionBadge(w as PermissionBadgeWidget),
);
registerRenderer('layer-toggle', (w) =>
  renderLayerToggle(w as LayerToggleWidget),
);
registerRenderer('why-care-callout', (w) =>
  renderWhyCareCallout(w as WhyCareCalloutWidget),
);
registerRenderer('code-english-translation', (w) =>
  renderCodeEnglishTranslation(w as CodeEnglishTranslationWidget),
);
