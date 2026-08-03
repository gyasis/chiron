/**
 * fsi-match-madness.mjs — standalone Duolingo-style "Match Madness" widget for FSI lessons.
 *
 * Exports renderMatchMadness(spec) -> self-contained HTML string (markup + <style> + <script>).
 * Consumed by assemble-fsi.mjs (ESM, node 20). No dependencies, no build step.
 *
 * Game design: the TIMER is the antagonist. There is no accuracy gate — the
 * player freely picks a set; when the countdown hits 0 the run ends. The combo
 * counter (+1 per correct, reset on wrong) is the stake.
 *
 * NOT derived from skill/lib/widgets/match-madness.ts — fresh implementation
 * against measured timings from a real recording.
 */

// ---------------------------------------------------------------------------
// Tunables (all game feel lives here)
// ---------------------------------------------------------------------------
const TIME_BONUS_SEC = 1;    // added on a correct match
const TIME_PENALTY_SEC = 3;  // removed on a wrong match

// Measured animation chain (do not invent new values):
const HOLD_MS = 150;         // correct pair holds green
const VANISH_MS = 50;        // then shrink+fade
const EMPTY_MS = 100;        // slot sits empty before the next pair is injected
const WRONG_LOCK_MS = 300;   // input lockout on a wrong match (old widget's 1500ms was the bug)

const ROWS_MOBILE = 5;       // pairs in play below the desktop breakpoint
const ROWS_DESKTOP = 7;      // pairs in play at >=900px (harder scanning)
const DESKTOP_MQ = '(min-width: 900px)';

const LOW_TIME_SEC = 15;     // timer bar turns to the error colour below this
const FIT_FLOOR_REM = 0.62;  // fit-text never shrinks below this

// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderMatchMadness(spec = {}) {
  // Sanitise the id: it becomes DOM ids, CSS selectors and a keyframe name.
  let id = String(spec.id || 'mm').replace(/[^A-Za-z0-9_-]/g, '-');
  if (!/^[A-Za-z]/.test(id)) id = 'mm-' + id;

  const title = String(spec.title || 'Match Madness');
  const timerSec = Number(spec.timerSec) > 0 ? Number(spec.timerSec) : 120;

  const sets = (Array.isArray(spec.sets) ? spec.sets : []).map((s, i) => ({
    id: String(s.id || 'set-' + (i + 1)),
    title: String(s.title || 'Set ' + (i + 1)),
    mode: String(s.mode || 'vocab-pair'),
    pairs: (Array.isArray(s.pairs) ? s.pairs : []).map((p, j) => ({
      id: String(p.id || 'p' + (j + 1)),
      left: String(p.left || ''),
      right: String(p.right || ''),
    })),
  }));

  const payload = { id, timerSec, sets };
  // <-escape so pair text can never contain a literal </script> breakout.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');

  const setButtons = sets
    .map((s) =>
      `<button type="button" class="fsi-mm-setbtn" data-set-id="${esc(s.id)}">${esc(s.title)}</button>`)
    .join('\n      ');

  return `<section class="fsi-mm" id="${id}">
  <style>${buildCss(id)}</style>
  <div class="fsi-mm-head">
    <div class="fsi-mm-titlerow">
      <h3 class="fsi-mm-title">${esc(title)}</h3>
      <div class="fsi-mm-combo">
        <span class="fsi-mm-combo-label">combo</span>
        <span class="fsi-mm-combo-now">0</span>
        <span class="fsi-mm-combo-best">best 0</span>
      </div>
    </div>
    <div class="fsi-mm-timerrow">
      <div class="fsi-mm-timer" role="timer" aria-label="Time remaining">
        <div class="fsi-mm-timer-fill"></div>
      </div>
      <span class="fsi-mm-timer-text">${timerSec}s</span>
    </div>
    <div class="fsi-mm-sets" role="group" aria-label="Choose a set">
      ${setButtons}
    </div>
  </div>
  <div class="fsi-mm-stage">
    <p class="fsi-mm-intro">Pick a set to start — the clock starts immediately.</p>
    <div class="fsi-mm-board" role="group" aria-label="${esc(title)} matching board" hidden></div>
    <div class="fsi-mm-summary" hidden></div>
  </div>
  <p class="fsi-mm-live fsi-mm-vh" aria-live="polite"></p>
  <script type="application/json" id="${id}-data">${json}</script>
  <script>${buildScript(id)}</script>
</section>`;
}

// ---------------------------------------------------------------------------
// CSS — every rule scoped under the instance id; only --chiron-* custom
// properties are consumed (with fallbacks), so all five themes skin it freely.
// ---------------------------------------------------------------------------
function buildCss(id) {
  const S = `#${id}`;
  const shake = `fsi-mm-${id}-shake`;
  return `
${S}.fsi-mm{ display:block; position:relative; box-sizing:border-box; max-width:900px; margin:1.5rem auto;
  background:var(--chiron-surface,#fff); color:var(--chiron-fg,#1a1a1a);
  border:1px solid var(--chiron-border,#e5e0d8); border-radius:12px;
  padding:.9rem; font-family:var(--chiron-font-body,Georgia,serif); }
${S} *, ${S} *::before, ${S} *::after{ box-sizing:border-box; }

${S} .fsi-mm-titlerow{ display:flex; align-items:baseline; justify-content:space-between; gap:.75rem; flex-wrap:wrap; }
${S} .fsi-mm-title{ margin:0; font-family:var(--chiron-font-heading,Georgia,serif); font-size:1.15rem; color:var(--chiron-fg,#1a1a1a); }
${S} .fsi-mm-combo{ display:flex; align-items:baseline; gap:.45rem; font-variant-numeric:tabular-nums; }
${S} .fsi-mm-combo-label{ font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--chiron-muted,#7a7a7a); }
${S} .fsi-mm-combo-now{ font-weight:700; font-size:1.2rem; color:var(--chiron-warm-accent,#b45309); }
${S} .fsi-mm-combo-best{ font-size:.75rem; color:var(--chiron-muted,#7a7a7a); }

${S} .fsi-mm-timerrow{ display:flex; align-items:center; gap:.6rem; margin:.55rem 0; }
/* The fill is anchored RIGHT so depletion visibly eats the bar left-to-right. */
${S} .fsi-mm-timer{ flex:1; height:10px; border-radius:999px; overflow:hidden;
  background:color-mix(in srgb, var(--chiron-border,#e5e0d8) 65%, transparent);
  display:flex; justify-content:flex-end; }
${S} .fsi-mm-timer-fill{ height:100%; width:100%; border-radius:inherit;
  background:var(--chiron-accent,#1e3a5f); transition:width .12s linear, background-color .3s; }
${S} .fsi-mm-timer.is-low .fsi-mm-timer-fill{ background:var(--chiron-error,#b91c1c); }
${S} .fsi-mm-timer-text{ font-size:.8rem; min-width:2.8em; text-align:right;
  color:var(--chiron-fg-secondary,#4a4a4a); font-variant-numeric:tabular-nums; }

${S} .fsi-mm-sets{ display:flex; flex-wrap:wrap; gap:.4rem; }
${S} .fsi-mm-setbtn{ font:inherit; font-size:.8rem; padding:.3rem .75rem; border-radius:999px; cursor:pointer;
  border:1px solid var(--chiron-border,#e5e0d8); background:var(--chiron-elevated,#f0ebe4);
  color:var(--chiron-fg-secondary,#4a4a4a); }
${S} .fsi-mm-setbtn:focus-visible{ outline:2px solid var(--chiron-accent-light,#2d5986); outline-offset:2px; }
${S} .fsi-mm-setbtn.is-active{ border-color:var(--chiron-accent,#1e3a5f);
  background:color-mix(in srgb, var(--chiron-accent,#1e3a5f) 14%, var(--chiron-surface,#fff));
  color:var(--chiron-fg,#1a1a1a); }

${S} .fsi-mm-stage{ margin-top:.75rem; margin-bottom:.5rem; }
${S} .fsi-mm-intro{ margin:.5rem 0; color:var(--chiron-muted,#7a7a7a); font-size:.9rem; }

${S} .fsi-mm-board{ display:grid; grid-template-columns:1fr 1fr; gap:.5rem .9rem; }
${S} .fsi-mm-slot{ display:flex; min-height:3.25rem; }
${S} .fsi-mm-tile{ flex:1; min-width:0; min-height:3.25rem; padding:.25rem .55rem;
  display:flex; align-items:center; justify-content:center;
  white-space:nowrap; overflow:hidden;
  font:inherit; font-size:.95rem; line-height:1.2; cursor:pointer;
  color:var(--chiron-fg,#1a1a1a);
  background:var(--chiron-elevated,#f0ebe4);
  border:1.5px solid var(--chiron-border,#e5e0d8);
  border-radius:10px;
  transition:background-color .1s, border-color .1s, transform ${VANISH_MS}ms ease-in, opacity ${VANISH_MS}ms ease-in; }
${S} .fsi-mm-tile:focus-visible{ outline:2px solid var(--chiron-accent-light,#2d5986); outline-offset:2px; }
${S} .fsi-mm-tile:disabled{ cursor:default; }
/* State tints are a mix of the status colour with the theme SURFACE, so text
   stays legible on both cream and dark grounds without hardcoded rgba. */
${S} .fsi-mm-tile.is-selected{ border-color:var(--chiron-accent,#1e3a5f);
  background:color-mix(in srgb, var(--chiron-accent,#1e3a5f) 16%, var(--chiron-surface,#fff)); }
${S} .fsi-mm-tile.is-correct{ border-color:var(--chiron-success,#166534);
  background:color-mix(in srgb, var(--chiron-success,#166534) 22%, var(--chiron-surface,#fff)); }
${S} .fsi-mm-tile.is-wrong{ border-color:var(--chiron-error,#b91c1c);
  background:color-mix(in srgb, var(--chiron-error,#b91c1c) 18%, var(--chiron-surface,#fff));
  animation:${shake} ${WRONG_LOCK_MS}ms linear; }
${S} .fsi-mm-tile.is-vanish{ transform:scale(.7); opacity:0; }
@keyframes ${shake}{
  0%,100%{ transform:translateX(0); }
  16%{ transform:translateX(-5px); } 33%{ transform:translateX(5px); }
  50%{ transform:translateX(-5px); } 66%{ transform:translateX(5px); }
  83%{ transform:translateX(-5px); }
}

${S} .fsi-mm-summary{ text-align:center; padding:1.25rem .75rem;
  border:1px dashed var(--chiron-divider,#ede8df); border-radius:10px; }
${S} .fsi-mm-summary h4{ margin:0 0 .35rem; font-family:var(--chiron-font-heading,Georgia,serif);
  font-size:1.1rem; color:var(--chiron-fg,#1a1a1a); }
${S} .fsi-mm-stats{ display:flex; justify-content:center; gap:1.5rem; margin:.6rem 0 1rem; }
${S} .fsi-mm-stat{ display:flex; flex-direction:column; align-items:center; }
${S} .fsi-mm-stat b{ font-size:1.35rem; color:var(--chiron-accent,#1e3a5f); font-variant-numeric:tabular-nums; }
${S} .fsi-mm-stat span{ font-size:.7rem; color:var(--chiron-muted,#7a7a7a); text-transform:uppercase; letter-spacing:.05em; }
${S} .fsi-mm-replay{ font:inherit; font-size:.85rem; padding:.45rem 1.1rem; border-radius:999px; cursor:pointer;
  border:1px solid var(--chiron-accent,#1e3a5f);
  background:color-mix(in srgb, var(--chiron-accent,#1e3a5f) 15%, var(--chiron-surface,#fff));
  color:var(--chiron-fg,#1a1a1a); }
${S} .fsi-mm-replay:focus-visible{ outline:2px solid var(--chiron-accent-light,#2d5986); outline-offset:2px; }

${S} .fsi-mm-vh{ position:absolute; width:1px; height:1px; margin:-1px; padding:0; border:0;
  overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

@media (max-width:599px){
  ${S}.fsi-mm{ padding:.7rem; margin:1rem auto; }
  ${S} .fsi-mm-board{ gap:.45rem .6rem; }
}
@media (min-width:900px){
  ${S} .fsi-mm-board{ gap:.6rem 2rem; }
  ${S} .fsi-mm-tile{ font-size:1rem; }
}
@media (prefers-reduced-motion: reduce){
  /* Drop shake + shrink; keep colour states and the exact same wall-clock timings. */
  ${S} .fsi-mm-tile{ transition:background-color .1s, border-color .1s, opacity ${VANISH_MS}ms linear; }
  ${S} .fsi-mm-tile.is-wrong{ animation:none; }
  ${S} .fsi-mm-tile.is-vanish{ transform:none; }
}
`;
}

// ---------------------------------------------------------------------------
// Browser script — an IIFE scoped to this instance (all lookups via the
// interpolated id, so multiple widgets on one page never collide). Data comes
// from the sibling <script type="application/json"> block, not concatenated JS.
// ---------------------------------------------------------------------------
function buildScript(id) {
  return `(function () {
  'use strict';
  var ID = ${JSON.stringify(id)};
  var TIME_BONUS_SEC = ${TIME_BONUS_SEC};
  var TIME_PENALTY_SEC = ${TIME_PENALTY_SEC};
  var HOLD_MS = ${HOLD_MS};
  var VANISH_MS = ${VANISH_MS};
  var EMPTY_MS = ${EMPTY_MS};
  var WRONG_LOCK_MS = ${WRONG_LOCK_MS};
  var ROWS_MOBILE = ${ROWS_MOBILE};
  var ROWS_DESKTOP = ${ROWS_DESKTOP};
  var LOW_TIME_SEC = ${LOW_TIME_SEC};
  var FIT_FLOOR_REM = ${FIT_FLOOR_REM};

  var root = document.getElementById(ID);
  if (!root) return;
  var DATA = JSON.parse(document.getElementById(ID + '-data').textContent);

  var boardEl = root.querySelector('.fsi-mm-board');
  var summaryEl = root.querySelector('.fsi-mm-summary');
  var introEl = root.querySelector('.fsi-mm-intro');
  var setsEl = root.querySelector('.fsi-mm-sets');
  var timerEl = root.querySelector('.fsi-mm-timer');
  var fillEl = root.querySelector('.fsi-mm-timer-fill');
  var timeText = root.querySelector('.fsi-mm-timer-text');
  var comboNow = root.querySelector('.fsi-mm-combo-now');
  var comboBest = root.querySelector('.fsi-mm-combo-best');
  var liveEl = root.querySelector('.fsi-mm-live');

  var mq = window.matchMedia(${JSON.stringify(DESKTOP_MQ)});
  var run = null;      // active set run; replaced wholesale on (re)start
  var timerId = null;

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function announce(msg) {
    // Clear-then-set so repeated identical messages still re-announce.
    liveEl.textContent = '';
    setTimeout(function () { liveEl.textContent = msg; }, 10);
  }

  function rowsForViewport() { return mq.matches ? ROWS_DESKTOP : ROWS_MOBILE; }

  // ---- fit-text: shrink until a long word fits on ONE line (never wrap/truncate)
  function fitText(btn) {
    btn.style.fontSize = '';
    var remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var floorPx = FIT_FLOOR_REM * remPx;
    var size = parseFloat(getComputedStyle(btn).fontSize);
    var guard = 40;
    while (btn.scrollWidth > btn.clientWidth && size > floorPx && guard-- > 0) {
      size -= 0.5;
      btn.style.fontSize = size + 'px';
    }
  }

  // ---- timer (deadline-based so bonuses/penalties are drift-free) ------------
  function startTimer() {
    stopTimer();
    run.deadline = performance.now() + run.remaining * 1000;
    timerId = setInterval(tick, 100);
    paintTimer();
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function tick() {
    run.remaining = Math.max(0, (run.deadline - performance.now()) / 1000);
    paintTimer();
    if (run.remaining <= 0) finishRun(false);
  }
  function addTime(sec) {
    var now = performance.now();
    // Bonus can never push past the original budget; penalty can hit 0 (tick ends the run).
    run.deadline = Math.min(now + DATA.timerSec * 1000, run.deadline + sec * 1000);
    run.remaining = Math.max(0, (run.deadline - now) / 1000);
    paintTimer();
  }
  function paintTimer() {
    var pct = Math.max(0, Math.min(100, (run.remaining / DATA.timerSec) * 100));
    fillEl.style.width = pct + '%';
    timeText.textContent = Math.ceil(run.remaining) + 's';
    timerEl.classList.toggle('is-low', run.remaining <= LOW_TIME_SEC);
  }

  function paintCombo() {
    comboNow.textContent = String(run.combo);
    comboBest.textContent = 'best ' + run.bestCombo;
  }

  // ---- board -----------------------------------------------------------------
  function startSet(setId) {
    var set = null;
    for (var i = 0; i < DATA.sets.length; i++) if (DATA.sets[i].id === setId) set = DATA.sets[i];
    if (!set) return;
    run = {
      set: set,
      pool: shuffle(set.pairs.slice()),
      slots: [],
      remaining: DATA.timerSec,
      deadline: 0,
      matches: 0,
      combo: 0,
      bestCombo: 0,
      selected: null,
      locked: false,
      over: false,
      epoch: 0
    };
    var btns = setsEl.querySelectorAll('.fsi-mm-setbtn');
    for (var b = 0; b < btns.length; b++) btns[b].classList.toggle('is-active', btns[b].dataset.setId === setId);
    buildBoard();
    introEl.hidden = true;
    summaryEl.hidden = true;
    boardEl.hidden = false;
    paintCombo();
    startTimer();
    announce('Set started: ' + set.title + '. ' + Math.ceil(run.remaining) + ' seconds.');
  }

  function buildBoard() {
    // epoch++ invalidates any pending match-animation timeouts from the old board
    // (they check the epoch before touching the DOM) — used by breakpoint rebuild.
    run.epoch++;
    run.selected = null;
    run.locked = false;
    boardEl.innerHTML = '';
    run.slots = [];

    var rows = Math.min(rowsForViewport(), run.pool.length);
    if (rows <= 0) return;
    boardEl.style.gridTemplateRows = 'repeat(' + rows + ', minmax(3.25rem, auto))';

    var sides = ['L', 'R'];
    for (var s = 0; s < 2; s++) {
      for (var r = 0; r < rows; r++) {
        var el = document.createElement('div');
        el.className = 'fsi-mm-slot';
        el.style.gridColumn = s === 0 ? '1' : '2';
        el.style.gridRow = String(r + 1);
        boardEl.appendChild(el);
        run.slots.push({ el: el, side: sides[s], row: r, pair: null, phase: null, btn: null });
      }
    }

    var initial = run.pool.splice(0, rows);
    var leftOrder = shuffle(initial.slice());
    var rightOrder = shuffle(initial.slice());
    // A pair must never sit side-by-side on the initial shuffle: swap collisions away.
    var guard = 20;
    while (guard-- > 0) {
      var bad = -1;
      for (var i = 0; i < rows; i++) if (leftOrder[i].id === rightOrder[i].id) { bad = i; break; }
      if (bad < 0 || rows < 2) break;
      var j = (bad + 1) % rows;
      var tmp = rightOrder[bad]; rightOrder[bad] = rightOrder[j]; rightOrder[j] = tmp;
    }
    for (var k = 0; k < rows; k++) {
      placeTile(slotAt('L', k), leftOrder[k]);
      placeTile(slotAt('R', k), rightOrder[k]);
    }
  }

  function slotAt(side, row) {
    for (var i = 0; i < run.slots.length; i++)
      if (run.slots[i].side === side && run.slots[i].row === row) return run.slots[i];
    return null;
  }

  function placeTile(slot, pair) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fsi-mm-tile';
    b.textContent = slot.side === 'L' ? pair.left : pair.right;
    b.setAttribute('aria-pressed', 'false');
    slot.el.appendChild(b);
    slot.pair = pair;
    slot.phase = 'live';
    slot.btn = b;
    fitText(b);
  }

  function clearSlot(slot) {
    if (slot.btn) slot.btn.remove();
    slot.btn = null;
    slot.pair = null;
    slot.phase = null;
  }

  // ---- selection + match resolution -----------------------------------------
  function select(slot) {
    run.selected = slot;
    slot.btn.classList.add('is-selected');
    slot.btn.setAttribute('aria-pressed', 'true');
  }
  function deselect() {
    var s = run.selected;
    if (s && s.btn) {
      s.btn.classList.remove('is-selected');
      s.btn.setAttribute('aria-pressed', 'false');
    }
    run.selected = null;
  }

  function onTap(slot) {
    var sel = run.selected;
    if (!sel) { select(slot); return; }                     // first tap: instant select
    if (sel === slot) { deselect(); return; }               // same tile: instant deselect
    if (sel.side === slot.side) { deselect(); select(slot); return; } // same side: selection MOVES
    if (sel.pair.id === slot.pair.id) resolveCorrect(sel, slot);
    else resolveWrong(sel, slot);
  }

  function resolveCorrect(a, b) {
    run.selected = null;
    run.combo++;
    run.matches++;
    if (run.combo > run.bestCombo) run.bestCombo = run.combo;
    addTime(TIME_BONUS_SEC);
    paintCombo();
    var hadFocus = document.activeElement === a.btn || document.activeElement === b.btn;
    a.phase = 'resolving'; b.phase = 'resolving';
    [a, b].forEach(function (s) {
      s.btn.classList.remove('is-selected');
      s.btn.classList.add('is-correct');
      s.btn.setAttribute('aria-pressed', 'false');
      s.btn.disabled = true; // no re-taps mid-animation; the rest of the board stays live
    });
    announce('Correct: ' + a.pair.left + ' matches ' + a.pair.right + '. Combo ' + run.combo + '.');
    // Measured chain: green HOLD_MS -> shrink+fade VANISH_MS -> slot empty EMPTY_MS
    // -> inject the next pool pair into those SAME two slots (no reflow, ever).
    var me = run, epoch = run.epoch;
    setTimeout(function () {
      if (me !== run || epoch !== run.epoch) return;
      a.btn.classList.add('is-vanish');
      b.btn.classList.add('is-vanish');
      setTimeout(function () {
        if (me !== run || epoch !== run.epoch) return;
        clearSlot(a); clearSlot(b);
        setTimeout(function () {
          if (me !== run || epoch !== run.epoch) return;
          refill(a, b, hadFocus);
          checkComplete();
        }, EMPTY_MS);
      }, VANISH_MS);
    }, HOLD_MS);
  }

  function refill(slotA, slotB, focus) {
    var next = run.pool.shift();
    if (!next) return;
    var leftSlot = slotA.side === 'L' ? slotA : slotB;
    var rightSlot = slotA.side === 'L' ? slotB : slotA;
    placeTile(leftSlot, next);
    placeTile(rightSlot, next);
    // Keyboard players: keep focus on the board when their tile vanished under them.
    if (focus && leftSlot.btn) leftSlot.btn.focus();
  }

  function resolveWrong(a, b) {
    run.locked = true; // global input lockout — exactly WRONG_LOCK_MS
    run.combo = 0;
    paintCombo();
    addTime(-TIME_PENALTY_SEC);
    [a, b].forEach(function (s) { s.btn.classList.add('is-wrong'); });
    announce('Wrong match. Combo reset.');
    var me = run, epoch = run.epoch;
    setTimeout(function () {
      if (me !== run) return;
      run.locked = false;
      if (epoch !== run.epoch) return;
      [a, b].forEach(function (s) {
        if (s.btn) {
          s.btn.classList.remove('is-wrong', 'is-selected');
          s.btn.setAttribute('aria-pressed', 'false');
        }
      });
      run.selected = null; // BOTH deselect; the player must re-tap
    }, WRONG_LOCK_MS);
  }

  function checkComplete() {
    if (run.pool.length) return;
    for (var i = 0; i < run.slots.length; i++) if (run.slots[i].pair) return;
    finishRun(true);
  }

  function finishRun(cleared) {
    if (run.over) return;
    run.over = true;
    stopTimer();
    var setId = run.set.id;
    summaryEl.innerHTML = '';
    var h = document.createElement('h4');
    h.textContent = cleared ? 'Set complete!' : "Time's up!";
    var stats = document.createElement('div');
    stats.className = 'fsi-mm-stats';
    [
      [String(run.matches), 'matches'],
      [String(run.bestCombo), 'best combo'],
      [Math.ceil(run.remaining) + 's', 'time left']
    ].forEach(function (pair) {
      var d = document.createElement('div');
      d.className = 'fsi-mm-stat';
      var bb = document.createElement('b'); bb.textContent = pair[0];
      var sp = document.createElement('span'); sp.textContent = pair[1];
      d.appendChild(bb); d.appendChild(sp);
      stats.appendChild(d);
    });
    var replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'fsi-mm-replay';
    replay.textContent = cleared ? 'Play again' : 'Try again';
    replay.addEventListener('click', function () { startSet(setId); });
    summaryEl.appendChild(h);
    summaryEl.appendChild(stats);
    summaryEl.appendChild(replay);
    boardEl.hidden = true;
    summaryEl.hidden = false;
    announce((cleared ? 'Set complete. ' : 'Time is up. ') +
      run.matches + ' matches, best combo ' + run.bestCombo + '.');
  }

  // ---- events ----------------------------------------------------------------
  setsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.fsi-mm-setbtn');
    if (b) startSet(b.dataset.setId);
  });

  boardEl.addEventListener('click', function (e) {
    if (!run || run.over || run.locked) return;
    var btn = e.target.closest('.fsi-mm-tile');
    if (!btn) return;
    for (var i = 0; i < run.slots.length; i++) {
      if (run.slots[i].btn === btn && run.slots[i].phase === 'live') { onTap(run.slots[i]); return; }
    }
  });

  // Arrow keys move focus across the grid; Enter/Space activate natively (real <button>s).
  boardEl.addEventListener('keydown', function (e) {
    if (!run || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) < 0) return;
    var cur = null;
    for (var i = 0; i < run.slots.length; i++)
      if (run.slots[i].btn === document.activeElement) cur = run.slots[i];
    if (!cur) return;
    e.preventDefault();
    var live = run.slots.filter(function (s) { return s.phase === 'live'; });
    var target = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      var dir = e.key === 'ArrowUp' ? -1 : 1;
      var col = live.filter(function (s) { return s.side === cur.side; })
        .sort(function (x, y) { return x.row - y.row; });
      target = col[col.indexOf(cur) + dir] || null;
    } else {
      var wantSide = e.key === 'ArrowLeft' ? 'L' : 'R';
      if (wantSide !== cur.side) {
        target = live.filter(function (s) { return s.side === wantSide; })
          .sort(function (x, y) {
            return Math.abs(x.row - cur.row) - Math.abs(y.row - cur.row);
          })[0] || null;
      }
    }
    if (target && target.btn) target.btn.focus();
  });

  // Breakpoint cross (5 <-> 7 rows): rebuild the board with the surviving pairs
  // reshuffled, preserving timer/combo/matches. Pairs mid-resolve are already
  // scored, so they are dropped; their replacements are still in the pool.
  mq.addEventListener('change', function () {
    if (!run || run.over) return;
    var seen = {};
    var onBoard = [];
    for (var i = 0; i < run.slots.length; i++) {
      var s = run.slots[i];
      if (s.pair && s.phase === 'live' && !seen[s.pair.id]) {
        seen[s.pair.id] = true;
        onBoard.push(s.pair);
      }
    }
    run.pool = shuffle(onBoard.concat(run.pool));
    buildBoard();
    checkComplete();
  });

  // Same-breakpoint resizes only change tile widths: re-run fit-text, debounced.
  var resizeT = null;
  window.addEventListener('resize', function () {
    if (!run || run.over) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (!run || run.over) return;
      run.slots.forEach(function (s) { if (s.btn) fitText(s.btn); });
    }, 150);
  });
})();`;
}
