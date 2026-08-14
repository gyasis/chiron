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
  greeting: 'Ask me anything from your library — I\'ll cite the lessons it came from.',
  extras:
    'Always prefer the learner\'s own lessons over general knowledge, and cite them. If the answer is ' +
    'NOT in the retrieved passages, say so in one sentence before answering from general knowledge. ' +
    'Keep Italian terms in italics with a short English gloss the first time they appear.',
};

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
        defaultWidth: 'full',
        autoMount: true,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--chiron-accent').trim(),
        autoInjectCss: true,
      },
    });
  } catch (e) {
    return fail('Acolyte failed to start.', String(e && e.message || e));
  }

  $('#boot')?.remove();
  handle.open();

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
