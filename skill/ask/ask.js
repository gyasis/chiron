/*
 * Chiron · Ask — tier 1 of the three-tier acolyte model (PRD §8).
 *
 * The whole-corpus surface: a page you go to and ask. Acolyte does the chat,
 * the retrieval and the voice; this file is only the Chiron chrome around it —
 * scope selection, thread history, and the wiring to our own corpus.
 *
 * Deliberately thin. Anything that starts to look like chat UI belongs in
 * acolyte, not here.
 */
import { mount } from './vendor/acolyte.js';

const $ = s => document.querySelector(s);
const LS_THREADS = 'chiron.ask.threads';
const LS_SCOPE = 'chiron.ask.scope';

const DOMAIN_LABEL = {
  medicine: 'Medicine',
  'medical-italian': 'Medical Italian',
  'language-it': 'Italian',
  'video-it': 'Italian · Video',
  code: 'Code',
};

/** Corpus for a scope. `all` is the full body; anything else is a domain shard —
 *  the corpus is lopsided (medicine is ~95% of it), so a scoped ask must never
 *  pay for the whole thing. See build-library-corpus.mjs. */
const corpusUrl = scope =>
  scope === 'all' ? '/library/library.corpus.json' : `/library/library.corpus.${scope}.json`;

const PERSONA = {
  role:
    'You are Chiron, the study companion for one learner (a doctor learning medicine and Italian). ' +
    'You answer from that learner\'s OWN lessons. You are not a lecturer — you find, connect and ' +
    'compare what they have already studied, and you say plainly when something is not in the library yet.',
  tone: 'concise',
  grounding: 'permissive',
  speakStyle: 'verbatim',
  // Empty string opts out of acolyte's greeting message — the host renders its
  // own hero instead (below), which teaches what the page is FOR.
  greeting: '',
  extras:
    'Always prefer the learner\'s own lessons over general knowledge, and cite them. If the answer is ' +
    'NOT in the retrieved passages, say so in one sentence before answering from general knowledge. ' +
    'Keep Italian terms in italics with a short English gloss the first time they appear.',
};

/** Read Chiron's own CSS variables and hand them to acolyte as theme tokens, so
 *  the widget inherits the library's palette instead of duplicating hex codes —
 *  and follows the light/dark switch for free. */
function tokens() {
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    bg: v('--chiron-bg'),
    fg: v('--chiron-fg'),
    'fg-muted': v('--chiron-fg-secondary'),
    'fg-faint': v('--chiron-muted'),
    surface: v('--chiron-surface'),
    'surface-alt': v('--chiron-elevated'),
    border: v('--chiron-border'),
    'border-soft': v('--chiron-divider'),
    'border-strong': v('--chiron-border'),
    accent: v('--chiron-accent'),
    'accent-light': v('--chiron-elevated'),
    'accent-contrast': v('--chiron-surface'),
    // The pilot's user bubble is a quiet grey pill, NOT an accent-filled one —
    // the accent is reserved for the send button and citation chrome.
    'msg-user-bg': v('--chiron-elevated'),
    'msg-user-fg': v('--chiron-fg'),
    radius: '10px',
    'radius-lg': '14px',
    font: "'Source Sans 3','Inter',system-ui,sans-serif",
    'font-size': '15px',
    shadow: 'none',
  };
}

/* ─── boot ─── */

async function boot() {
  let cfg, index;
  try {
    [cfg, index] = await Promise.all([
      fetch('/ask/config.json').then(r => r.json()),
      fetch('/library/library.index.json').then(r => r.json()),
    ]);
  } catch (e) {
    return fail('Could not reach the Chiron server.', 'Start it with <code>skill/server/serve.sh</code>, then reload.');
  }

  const counts = {};
  for (const l of index.lessons || []) if (l.ready && l.path) counts[l.domain] = (counts[l.domain] || 0) + 1;

  buildScopeSelector(counts);
  renderThreads();
  $('#ver').textContent = cfg.model || '';

  const scope = localStorage.getItem(LS_SCOPE) || 'all';
  $('#scope').value = scope;

  // The proxy is shape-agnostic; the server says which shape the upstream speaks.
  const llm = cfg.provider === 'ollama'
    ? { provider: 'ollama', host: cfg.base, model: cfg.model }
    : { provider: 'openai-compatible', baseUrl: cfg.base, model: cfg.model, apiKey: 'proxied' };

  let handle;
  try {
    handle = mount({
      llm,
      persona: PERSONA,
      rag: {
        sourceUrl: corpusUrl(scope),
        topK: 6,
        showSourceCards: true,
        sourcesStyle: 'cards',
        crossPageReferences: false,   // the corpus IS every page — no need to crawl
      },
      voice: { enabled: true },
      storage: { namespace: 'chiron-ask' },
      ui: {
        targetSelector: '#host',
        // The panel IS the page here, so it lays out as a flex child instead of
        // a fixed drawer. Without this the host has to undo position:fixed with
        // !important, which re-breaks on every acolyte layout change.
        layout: 'inline',
        contentWidth: '760px',
        autoInjectCss: true,
        // Chiron's palette, straight into acolyte's tokens. Everything acolyte
        // paints is tokenised, so this is the whole reskin — no CSS overrides
        // for colour, only for the few structural touches in skin.css.
        theme: tokens(),
      },
    });
  } catch (e) {
    return fail('Acolyte failed to start.', String(e && e.message || e));
  }

  $('#boot')?.remove();
  renderHero(handle);   // inline panels open themselves — no handle.open() here

  $('#scope').addEventListener('change', () => {
    const s = $('#scope').value;
    localStorage.setItem(LS_SCOPE, s);
    // Re-target the corpus WITHOUT a remount. Needs acolyte's RAGEngine.update()
    // — before that, configure({rag}) cleared the index and re-fetched the OLD
    // sourceUrl, so a scope change silently reloaded the previous corpus.
    handle.configure({ rag: { sourceUrl: corpusUrl(s) } });
    setHint(s);
  });
  setHint(scope);

  window.chironAsk = {
    handle,
    newThread() { handle.configure({}); location.reload(); },
    theme() {
      const r = document.documentElement;
      const next = r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      r.setAttribute('data-theme', next);
      try { localStorage.setItem('chiron.theme', next); } catch {}
    },
  };
}

/* ─── the empty state ───
 * Acolyte's greeting is one chat bubble; the pilot's empty state is a hero with
 * four cards, and those cards are the only thing on the page that TEACHES what
 * it can do — ask about something half-remembered, turn it into practice, ask
 * about your own progress, send it to the generator. Worth keeping. */

const SUGGESTIONS = [
  ['Ask about something you half-remember', 'Che differenza c\'è tra affanno e dispnea?',
   'Che differenza c\'è tra <i>affanno</i> e <i>dispnea</i>?'],
  ['Turn it into practice', 'Interrogami sulle frasi da reparto per il dolore toracico.',
   'Quiz me on the chest-pain ward phrases.'],
  ['Ask about your own progress', 'Cosa non ho ancora studiato in cardiologia?',
   'What haven\'t I covered in cardiology?'],
  ['Send it to the generator', 'Fai una lezione da reparto sull\'iperkaliemia.',
   'Make a ward lesson on hyperkalemia.'],
];

function renderHero(handle) {
  const box = document.querySelector('#host .acolyte-messages');
  if (!box || box.childElementCount) return;

  const hero = document.createElement('div');
  hero.className = 'ask-hero';
  hero.innerHTML = `
    <div class="mk">◈</div>
    <h1>What do you want to work on?</h1>
    <p>Ask anything. Answers are grounded in your own lessons — and cite them.</p>
    <div class="sugg">${SUGGESTIONS.map(([t, q, sub], i) =>
      `<button class="sg" data-i="${i}"><b>${escapeHtml(t)}</b><span>${sub}</span></button>`).join('')}</div>`;
  box.appendChild(hero);

  hero.querySelectorAll('.sg').forEach(btn => btn.addEventListener('click', () => {
    const q = SUGGESTIONS[+btn.dataset.i][1];
    hero.remove();
    handle.send(q);
  }));

  // Any real message replaces the hero — including one the user types.
  new MutationObserver((_, obs) => {
    if (box.querySelector('.acolyte-msg')) { hero.remove(); obs.disconnect(); }
  }).observe(box, { childList: true });
}

/* ─── chrome ─── */

function buildScopeSelector(counts) {
  const sel = $('#scope');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const opts = [`<option value="all">Everything · ${total} lessons</option>`];
  for (const [dom, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    opts.push(`<option value="${dom}">${DOMAIN_LABEL[dom] || dom} · ${n} lessons</option>`);
  }
  sel.innerHTML = opts.join('');
}

function setHint(scope) {
  $('#scopehint').textContent = scope === 'all'
    ? 'Retrieval runs over every baked lesson and every section in it.'
    : `Only ${DOMAIN_LABEL[scope] || scope}. Faster, and it cannot drift into another subject.`;
}

function renderThreads() {
  let threads = [];
  try { threads = JSON.parse(localStorage.getItem(LS_THREADS) || '[]'); } catch {}
  const box = $('#threads');
  if (!threads.length) {
    box.innerHTML = '<div style="padding:6px 16px;font-size:12px;color:var(--chiron-muted);line-height:1.5">'
      + 'Your questions will collect here.</div>';
    return;
  }
  box.innerHTML = threads.slice(0, 40).map((t, i) =>
    `<button class="th${i === 0 ? ' on' : ''}"><span class="dot d-${t.scope || 'all'}"></span>${escapeHtml(t.q)}</button>`
  ).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fail(title, detail) {
  const b = $('#boot');
  if (b) b.innerHTML = `<div class="err"><b>${escapeHtml(title)}</b><br><br>${detail}</div>`;
}

boot();
