/*
 * The live view of what the pipeline is actually doing.
 *
 * Ask used to show a single "Thinking" for the whole turn. On the grounded path
 * that is a few seconds; on the deep path it was ninety, and a dead spinner for
 * ninety seconds is indistinguishable from a hang — you cannot tell whether to
 * wait or to rephrase.
 *
 * EVERY STEP HERE IS MEASURED. Nothing is scripted, and a step only appears
 * because the work it names actually started. The durations are wall-clock
 * around the real call, so if retrieval is slow the panel says retrieval is
 * slow rather than implying the model is. A fabricated progress display is
 * worse than none: it teaches you to ignore it.
 */

const listeners = new Set();

/** Emitted by the pipeline. `phase` is 'start' | 'end'. */
export function emit(id, phase, detail) {
  for (const fn of listeners) {
    try { fn({ id, phase, detail, t: performance.now() }); } catch { /* a bad listener must not break the pipeline */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Convenience: time an async call and emit around it. */
export async function track(id, detail, fn) {
  emit(id, 'start', detail);
  try {
    const out = await fn();
    emit(id, 'end', typeof detail === 'function' ? detail(out) : detail);
    return out;
  } catch (e) {
    emit(id, 'end', `failed — ${e.message}`);
    throw e;
  }
}

const LABEL = {
  embed: '🧭 Reading your question',
  search: '🔎 Searching your lessons',
  draft: '✍️ Drafting the answer',
  cards: '🎴 Matching your Anki cards',
};

/** A panel that renders whatever the pipeline emits, in order. */
export function panel() {
  const el = document.createElement('div');
  el.className = 'ask-steps';
  el.innerHTML = `<div class="as-h"><span class="as-caret">▾</span>
      <span class="as-label">Working…</span><span class="as-el">0.0s</span></div>
    <div class="as-b"></div>`;
  const body = el.querySelector('.as-b');
  const head = el.querySelector('.as-h');
  head.addEventListener('click', () => el.classList.toggle('closed'));

  const rows = new Map();
  const t0 = performance.now();
  const tick = setInterval(() => {
    el.querySelector('.as-el').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
  }, 100);

  // Drafting begins when RETRIEVAL ends, not when you press send. Starting it
  // at send put it first in the list and made its duration swallow the search
  // time — so the panel would blame the model for a slow lookup. The panel
  // starts it on the first retrieval 'end' it sees, or on a timeout when a turn
  // does no retrieval at all.
  let draftStarted = false;
  const startDraft = () => {
    if (draftStarted) return;
    draftStarted = true;
    emit('draft', 'start');
  };
  const draftFallback = setTimeout(startDraft, 2500);

  const off = subscribe(({ id, phase, detail, t }) => {
    if (id !== 'draft' && phase === 'end') startDraft();
    if (phase === 'start') {
      const row = document.createElement('div');
      row.className = 'as-st run';
      row.innerHTML = `<span class="as-dot"></span><span class="as-t">${LABEL[id] || id}${
        detail ? ` · ${escape_(detail)}` : ''}</span><em>…</em>`;
      body.appendChild(row);
      rows.set(id, { row, t });
    } else {
      const r = rows.get(id);
      if (!r) return;
      r.row.className = 'as-st';
      r.row.querySelector('em').textContent = ((t - r.t) / 1000).toFixed(1) + 's';
      if (detail) {
        r.row.querySelector('.as-t').textContent = `${LABEL[id] || id} · ${detail}`;
      }
    }
  });

  /** Called when the answer has landed: stop counting and fold away. */
  function finish() {
    clearInterval(tick);
    clearTimeout(draftFallback);
    off();
    const secs = (performance.now() - t0) / 1000;
    // The ticking counter stops on its own interval, so it can read 10.2s under
    // a summary saying 11.0s. Same number, one source.
    el.querySelector('.as-el').textContent = secs.toFixed(1) + 's';
    const n = rows.size;
    el.querySelector('.as-label').textContent =
      `Worked for ${secs.toFixed(1)}s · ${n} step${n === 1 ? '' : 's'}`;
    // Collapsed by default once done — the detail is there when a slow turn
    // makes you want it, and out of the way when it does not.
    el.classList.add('closed');
    // A turn with nothing worth showing should not leave an empty box.
    if (!n) el.remove();
  }

  return { el, finish, born: t0 };
}

function escape_(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
