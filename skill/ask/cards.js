/*
 * Anki cards, inside the answer.
 *
 * The session is an ELEMENT attached to the message that prompted it, not a
 * modal over the page. The answer stays on screen while you drill, and the
 * session becomes part of the transcript — scroll back and you can see that
 * you drilled these six after that question. (The pattern is Chainlit's
 * elements-on-a-message; the implementation is ours.)
 *
 * ANKI KEEPS THE SCHEDULING. Chiron owns spaced repetition for cards it
 * generates itself; for a card that already lives in Anki, a review taken here
 * is written straight back. If it cannot be written, the session never opens —
 * a card studied with nowhere to record it is worse than one not studied,
 * because both schedulers then believe different things about one memory.
 */

const EASE = [
  ['Again', 'again', '<1 m'],
  ['Hard', 'hard', '6 m'],
  ['Good', 'good', '1 d'],
  ['Easy', 'easy', '4 d'],
];

const SIDE = {
  you: ['🩺 you ask this', 'you'],
  them: ['🗣 the patient says this', 'them'],
  vocab: ['📖 vocabulary', 'vocab'],
};

let AVAILABLE = null;          // {anki, indexed, …} — probed once per page

export async function status() {
  if (AVAILABLE) return AVAILABLE;
  try {
    const r = await fetch('/cards/status');
    AVAILABLE = r.ok ? await r.json() : { anki: false, indexed: 0 };
  } catch {
    AVAILABLE = { anki: false, indexed: 0 };
  }
  return AVAILABLE;
}

/** Cards for a question, or [] when there is nothing worth offering. */
export async function relevant(query, { k = 6, deck = null } = {}) {
  const st = await status();
  if (!st.anki || !st.indexed) return [];
  try {
    const r = await fetch('/cards/relevant', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, k, deck }),
    });
    if (!r.ok) return [];
    const d = await r.json();
    // Below this the "match" is noise — a session of unrelated cards is worse
    // than no button, because it teaches you to distrust the button.
    return (d.cards || []).filter(c => c.score >= 0.42);
  } catch { return []; }
}

/** Open a session under `msg`. `cards` come from relevant(). */
export function drill(host, cards, { onClose } = {}) {
  let i = 0;
  const graded = [];
  const el = document.createElement('div');
  el.className = 'ask-cards';
  host.appendChild(el);

  const close = () => { el.remove(); onClose?.(); };

  const render = () => {
    const c = cards[i];
    const [label, cls] = SIDE[c.side] || SIDE.vocab;
    el.innerHTML = `
      <div class="ac-h">
        <b>Card ${i + 1} of ${cards.length}</b>
        <span class="ac-deck">${esc(c.deck.replace('Medical Italian::', ''))}</span>
        <button class="ac-x" title="Close">✕</button>
      </div>
      <div class="ac-bar"><i style="width:${(i / cards.length) * 100}%"></i></div>
      <div class="ac-face">
        <div class="ac-front">${esc(c.front)}</div>
        ${c.audio ? `<button class="ac-audio">▶ listen</button>` : ''}
        <div class="ac-back ac-hide">${esc(c.back)}</div>
        <div class="ac-prov ac-hide">
          <span class="ac-p">${esc(c.direction)}</span>
          <span class="ac-p ${cls}">${label}</span>
        </div>
      </div>
      <button class="ac-reveal">Show answer</button>
      <div class="ac-grades ac-hide">
        ${EASE.map(([t, , sub]) => `<button class="ac-g"><span>${t}</span><small>${sub}</small></button>`).join('')}
      </div>`;

    el.querySelector('.ac-x').onclick = close;
    const audio = el.querySelector('.ac-audio');
    if (audio) audio.onclick = () => {
      // Media comes through Chiron rather than straight from Anki, so the page
      // needs no second origin and no CORS grant on the collection.
      new Audio(`/cards/media/${encodeURIComponent(c.audio)}`).play().catch(() => {});
    };
    el.querySelector('.ac-reveal').onclick = () => {
      el.querySelectorAll('.ac-hide').forEach(n => n.classList.remove('ac-hide'));
      el.querySelector('.ac-reveal').remove();
    };
    [...el.querySelectorAll('.ac-g')].forEach((b, k) => b.onclick = () => {
      graded.push({ cardId: c.cardId, ease: EASE[k][1] });
      i += 1;
      i < cards.length ? render() : finish();
    });
  };

  const finish = async () => {
    const tally = {};
    graded.forEach(g => { tally[g.ease] = (tally[g.ease] || 0) + 1; });
    el.innerHTML = `
      <div class="ac-h"><b>Session done</b><span class="ac-deck">${cards.length} cards</span></div>
      <div class="ac-bar"><i style="width:100%"></i></div>
      <div class="ac-done">
        <div class="ac-tally">${Object.entries(tally)
          .map(([k, v]) => `<span>${k} × ${v}</span>`).join('')}</div>
        <div class="ac-sync">⏳ writing reviews to Anki…</div>
      </div>`;
    const sync = el.querySelector('.ac-sync');
    try {
      const r = await fetch('/cards/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviews: graded }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        sync.textContent = `✓ ${d.written} review${d.written === 1 ? '' : 's'} written to Anki`;
      } else {
        // Say exactly how many landed. "Some failed" with no number leaves you
        // unable to tell whether to redo the session.
        sync.classList.add('bad');
        sync.textContent = `⚠ ${d.written ?? 0} of ${d.of ?? graded.length} written — `
          + (d.detail || r.statusText || 'Anki refused the rest');
      }
    } catch (e) {
      sync.classList.add('bad');
      sync.textContent = `⚠ reviews NOT written — ${e.message}. Nothing was queued.`;
    }
  };

  render();
  return { close };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
