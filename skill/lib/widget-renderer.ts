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

/** List the kinds currently registered. Useful for sanity tests. */
export function registeredKinds(): WidgetKind[] {
  return Array.from(REGISTRY.keys());
}
