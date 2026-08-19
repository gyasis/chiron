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
import { createSemanticSource } from './semantic.js';

const $ = s => document.querySelector(s);
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
  let cfg, index, stats = null;
  try {
    [cfg, index, stats] = await Promise.all([
      fetch('/ask/config.json').then(r => r.json()),
      fetch('/library/library.index.json').then(r => r.json()),
      fetch('/library/library.corpus.stats.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
  } catch (e) {
    return fail('Could not reach the Chiron server.', 'Start it with <code>skill/server/serve.sh</code>, then reload.');
  }

  const counts = {};
  for (const l of index.lessons || []) if (l.ready && l.path) counts[l.domain] = (counts[l.domain] || 0) + 1;

  buildScopeSelector(counts, stats);

  const scope = localStorage.getItem(LS_SCOPE) || 'all';
  $('#scope').value = scope;

  // The proxy is shape-agnostic; the server says which shape the upstream speaks.
  const llm = cfg.provider === 'ollama'
    ? { provider: 'ollama', host: cfg.base, model: cfg.model }
    : { provider: 'openai-compatible', baseUrl: cfg.base, model: cfg.model, apiKey: 'proxied' };

  let corpusCache = null;
  const semantic = createSemanticSource({
    scope: () => $('#scope').value,
    corpusById: id => corpusCache?.get(id),
    embedUrl: '/ask/embed',
  });
  // The semantic source needs passage bodies to return; fetch the shard lazily
  // so a BM25-only session never pays for it.
  const primeCorpus = async () => {
    const s2 = $('#scope').value;
    if (s2 === 'all') return;
    const r = await fetch(corpusUrl(s2)).catch(() => null);
    if (r?.ok) corpusCache = new Map((await r.json()).map(p => [p.id, p]));
  };
  primeCorpus();

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
      // The semantic channel. Acolyte fuses it with its own BM25 via RRF; this
      // only supplies cosine-scored passages, and returns nothing at all when
      // the sidecar is missing, partial, or the embedder is down.
      plugins: [semantic.plugin],
      voice: { enabled: true },
      // dbName, NOT namespace — StorageConfig has no `namespace`, so the old
      // key was silently ignored and this instance shared the default
      // IndexedDB with any other acolyte mounted on the same origin.
      storage: { dbName: 'chiron-ask', historyEnabled: true },
      ui: {
        targetSelector: '#host',
        // The panel IS the page here, so it lays out as a flex child instead of
        // a fixed drawer. Without this the host has to undo position:fixed with
        // !important, which re-breaks on every acolyte layout change.
        layout: 'inline',
        // 760 was the pilot's mockup width; real answers carry tables and code,
        // and at 760 the table columns crush. 880 reads fine and fits them.
        contentWidth: '880px',
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
  adoptControls(handle, stats);

  /* DENSE-ONLY when the vectors are healthy; BM25 when they are not.
   *
   * Measured over 29 hand-written medicine questions (bge-m3, 1024d):
   *     dense 41.4%   hybrid 31.0%   bm25 20.7%
   * and on the control questions that DO contain the real term, dense ties BM25
   * at 75% — so dense gives up nothing and roughly doubles overall accuracy.
   * Hybrid is WORSE than dense alone because RRF rewards agreement, and
   * agreeing with a weaker channel is not a virtue. So the two do not blend:
   * whichever is trustworthy answers alone.
   *
   * acolyte's own BM25 stays configured, and is re-enabled the moment the dense
   * channel cannot serve (no sidecar, embedder down, scope 'all') — the page is
   * never left with no retrieval at all. */
  const pickChannel = async () => {
    const dense = await semantic.ready($('#scope').value);
    handle.configure({ rag: { enabled: !dense } });
    const st = semantic.status();
    $('#grounded').title = dense
      ? `semantic · ${st.detail}`
      : `keyword search — ${st.detail || 'no vectors for this scope'}`;
    return dense;
  };
  pickChannel().then(d => console.info('[chiron] retrieval:', d ? 'dense (bge-m3)' : 'bm25'));

  $('#scope').addEventListener('change', () => {
    const s = $('#scope').value;
    localStorage.setItem(LS_SCOPE, s);
    // Re-target the corpus WITHOUT a remount. Needs acolyte's RAGEngine.update()
    // — before that, configure({rag}) cleared the index and re-fetched the OLD
    // sourceUrl, so a scope change silently reloaded the previous corpus.
    handle.configure({ rag: { sourceUrl: corpusUrl(s) } });
    corpusCache = null; primeCorpus();
    pickChannel();
    setHint(s);
    setGrounded(stats, s);
  });
  setHint(scope);

  // Acolyte asks the host before navigating. Handle it: open the cited lesson in
  // a new tab so the conversation (and any playing audio) is not thrown away —
  // the citation was a reference, not a request to leave.
  document.addEventListener('acolyte:navigate', ev => {
    ev.preventDefault();
    window.open(ev.detail.url, '_blank', 'noopener');
  });

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

/* ─── adopt acolyte's controls into the pilot's chrome ───
 * The pilot puts the model picker under the composer, settings in the rail, and
 * a title + scope line in the topbar — not acolyte's header strip. Rather than
 * reimplement those controls (and inherit the bugs), the real elements are MOVED
 * into place: they keep every handler acolyte wired to them. */
function adoptControls(handle, stats) {
  const panel = document.querySelector('#host .acolyte-panel');
  if (!panel) return;

  // model picker → the composer meta row
  const picker = panel.querySelector('.acolyte-model-picker');
  if (picker) $('#cmeta').prepend(picker);

  // persona picker is ours — acolyte has no UI for it
  const persona = document.createElement('select');
  persona.title = 'Who answers';
  persona.innerHTML = '<option>Chiron · study companion</option>';
  persona.disabled = true;           // one persona for now; a real switcher is step 2
  picker?.after(persona);

  // settings gear → the rail footer, where the pilot put it
  const gear = panel.querySelector('.acolyte-header .acolyte-iconbtn[title^="Settings"]');
  if (gear) { gear.textContent = '⚙ Settings'; $('#settingsslot').appendChild(gear); }

  // "New question" in the rail drives acolyte's own clear-conversation button,
  // so history and state are cleared properly instead of by reloading the page.
  const plus = panel.querySelector('.acolyte-header .acolyte-iconbtn[title^="New"]');
  document.querySelector('.newchat').addEventListener('click', e => {
    e.preventDefault();
    handle.history.start();        // keeps the stored threads, starts a new one
    setTitle('New question');
    renderHero(handle);
  });

  // voice-out chip
  const vb = $('#voicebtn');
  vb.addEventListener('click', () => {
    const on = vb.classList.toggle('on');
    handle.configure({ voice: { enabled: on } });
  });

  // "Open in lesson" follows the top citation of the latest answer
  const open = $('#openlesson');
  new MutationObserver(() => {
    const first = panel.querySelector('.acolyte-msg:last-of-type .src-card');
    open.disabled = !first;
    open.onclick = first ? () => first.click() : null;
    const lastUser = [...panel.querySelectorAll('.acolyte-msg.user')].pop();
    if (lastUser) setTitle(lastUser.textContent.trim());
  }).observe(panel.querySelector('.acolyte-messages'), { childList: true, subtree: true });

  autogrow(panel.querySelector('.acolyte-input'));
  wireDispatch(handle, panel);
  wireThreads(handle);
  setGrounded(stats, localStorage.getItem(LS_SCOPE) || 'all');
}

/** The composer is one line tall and grows to fit, like the pilot. acolyte's own
 *  textarea is a fixed 40–140px scroll box, which reads as dead space at rest
 *  and hides the start of a long question once it fills. */
function autogrow(ta) {
  if (!ta) return;
  ta.rows = 1;                        // acolyte ships rows=2 — that is the dead space
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 170) + 'px'; };
  ta.addEventListener('input', fit);
  // acolyte clears the field itself on send, which fires no input event
  new MutationObserver(fit).observe(ta, { attributes: true, attributeFilter: ['value'] });
  ta.form?.addEventListener('submit', () => setTimeout(fit, 0));
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) setTimeout(fit, 0); });
  fit();
}

function setTitle(t) {
  $('#ttl').textContent = t.length > 60 ? t.slice(0, 60) + '…' : t;
}

/** State what is actually being searched. A lesson count is the wrong unit —
 *  retrieval returns passages, so that is the number worth showing. */
function setGrounded(stats, scope) {
  if (!stats) return;
  const n = scope === 'all' ? stats.total : (stats.byDomain?.[scope] ?? 0);
  $('#grounded').textContent = `Grounded · ${n.toLocaleString()} passages indexed`;
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

/** Label each scope by PASSAGES, not lessons — a passage is what retrieval
 *  actually returns, and the two numbers differ by ~60×. Falls back to lesson
 *  counts if the corpus stats file hasn't been built yet. */
function buildScopeSelector(counts, stats) {
  const sel = $('#scope');
  const unit = (dom) => {
    const p = dom === 'all' ? stats?.total : stats?.byDomain?.[dom];
    if (p != null) return `${p.toLocaleString()} passages`;
    const l = dom === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[dom];
    return `${l} lessons`;
  };
  const opts = [`<option value="all">Everything in the library · ${unit('all')}</option>`];
  for (const [dom, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    opts.push(`<option value="${dom}">${DOMAIN_LABEL[dom] || dom} · ${unit(dom)}</option>`);
  }
  sel.innerHTML = opts.join('');
}

function setHint(scope) {
  $('#scopehint').textContent = scope === 'all'
    ? 'Retrieval runs over every baked lesson and every section in it.'
    : `Only ${DOMAIN_LABEL[scope] || scope}. Faster, and it cannot drift into another subject.`;
  // The topbar states the scope too, and was left on its hardcoded default —
  // so a restored "Medical Italian" session still claimed to search everything.
  // Two places saying different things about what is being searched is worse
  // than either one alone.
  $('#tsub').textContent = `Scope: ${scope === 'all' ? 'everything' : (DOMAIN_LABEL[scope] || scope)}`
    + ' · grounded in your library';
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

/* ─── dispatch: turn an answer into work ───
 * The row under each answer is the thing a general chat cannot do — every button
 * hands off to a real Chiron endpoint that already exists, rather than a new
 * parallel mechanism:
 *   Listen  → acolyte's own per-message TTS
 *   Card    → POST /capture  →  POST /captures/{id}/cards   (the real SR rotation)
 *   Lesson  → POST /generate                                 (the real generator)
 *   Simpler → re-ask, in the same thread
 */

const DISPATCH_DEBOUNCE = 900;

function wireDispatch(handle, panel) {
  const box = panel.querySelector('.acolyte-messages');
  if (!box) return;
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    // An answer streams in token by token; wait for it to settle rather than
    // rebuilding the row on every chunk.
    timer = setTimeout(() => {
      box.querySelectorAll('.acolyte-msg.assistant:not([data-acts])').forEach(msg => {
        if (!msg.querySelector('.acolyte-msg-body')?.textContent.trim()) return;
        msg.dataset.acts = '1';
        dressSources(msg);
        msg.appendChild(buildActs(handle, panel, msg));
      });
    }, DISPATCH_DEBOUNCE);
  }).observe(box, { childList: true, subtree: true, characterData: true });
}

/** What this answer was about — the question, the answer, and where it came from. */
function answerContext(panel, msg) {
  const answer = msg.querySelector('.acolyte-msg-body')?.innerText.trim() || '';
  let q = '';
  for (let el = msg.previousElementSibling; el; el = el.previousElementSibling) {
    if (el.classList?.contains('acolyte-msg') && el.classList.contains('user')) { q = el.innerText.trim(); break; }
  }
  const sources = [...msg.querySelectorAll('.src-card')].map(c => {
    try { return JSON.parse(c.dataset.acolyteSource || '{}'); } catch { return {}; }
  }).filter(s => s.meta);
  return { question: q, answer, sources, top: sources[0]?.meta || {} };
}

function buildActs(handle, panel, msg) {
  const row = document.createElement('div');
  row.className = 'ask-acts';
  const add = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'act' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', () => fn(b, row));
    row.appendChild(b);
    return b;
  };

  // Listen — acolyte already renders a per-message speak button; surface it here
  // rather than starting a second TTS path that could talk over the first.
  const speak = msg.querySelector('.acolyte-msg-speak');
  if (speak) add('🎧 Listen', '', () => speak.click());

  add('➕ Add as a card', '', (b, r) => makeCard(panel, msg, b, r));
  add('📘 Make a lesson from this', '', (b, r) => lessonForm(panel, msg, r));
  add('↻ Again, simpler', 'ghost', () =>
    handle.send('Explain that again, simpler and shorter. Same language as before.'));
  return row;
}

function say(row, text, kind) {
  let n = row.querySelector('.act-note');
  if (!n) { n = document.createElement('div'); n.className = 'act-note'; row.appendChild(n); }
  n.className = 'act-note' + (kind ? ' ' + kind : '');
  n.innerHTML = text;
  return n;
}

async function makeCard(panel, msg, btn, row) {
  const c = answerContext(panel, msg);
  btn.disabled = true; say(row, 'Capturing…');
  try {
    // Provenance matters more than the text: the card generator writes better
    // cards when it knows the question, the answer AND the lesson section.
    const cap = await post('/capture', {
      kind: 'answer',
      text: (c.question || c.answer).slice(0, 200),
      question: c.question,
      source_answer: c.answer,
      surrounding_text: c.sources.map(s => `${s.title}\n${s.meta?.section || ''}`).join('\n\n'),
      lesson_slug: c.top.lessonId || null,
      section_id: c.top.section || null,
      concept: c.top.subject || c.top.lesson || null,
      source: 'ask',
    });
    say(row, 'Captured — generating cards…');
    const res = await post(`/captures/${cap.id}/cards`, {});
    // /captures/{id}/cards returns the card objects themselves, not a count —
    // reading it as a number printed "[object Object]" to the learner.
    const arr = [res.cards, res.created, res.items].find(Array.isArray);
    const n = arr ? arr.length : (typeof res.count === 'number' ? res.count : null);
    say(row, n != null
      ? `✓ ${n} card${n === 1 ? '' : 's'} added to the review rotation.`
      : '✓ Sent to the card spine.', 'ok');
  } catch (e) {
    // Fail loud and name the fix — a silent no-op here would mean believing a
    // card exists when it does not, and only finding out at review time.
    say(row, `Could not add a card — ${esc(e.message)}`, 'err');
    btn.disabled = false;
  }
}

function lessonForm(panel, msg, row) {
  if (row.querySelector('.act-form')) return;
  const c = answerContext(panel, msg);
  const f = document.createElement('form');
  f.className = 'act-form';
  const suggested = (c.top.lesson || c.question || '').replace(/\?+$/, '').slice(0, 80);
  f.innerHTML = `
    <input name="subject" value="${esc(suggested)}" placeholder="Lesson subject" required>
    <select name="domain">${['medicine','medical-italian','language-it','code']
      .map(d => `<option value="${d}"${d === (c.top.domain || 'medicine') ? ' selected' : ''}>${DOMAIN_LABEL[d] || d}</option>`).join('')}</select>
    <button type="submit">Generate</button>`;
  row.appendChild(f);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(f);
    f.querySelector('button').disabled = true;
    say(row, 'Queueing…');
    try {
      const r = await post('/generate', {
        domain: fd.get('domain'), subject: fd.get('subject'),
        source: 'Chiron · Ask', extra: { from_question: c.question },
      });
      if (r.needs_switch) { say(row, esc(r.reason), 'err'); f.querySelector('button').disabled = false; return; }
      f.remove();
      const ref = r.job_id || r.id || r.slug;
      say(row, `✓ Queued${r.slug ? ` — <b>${esc(r.slug)}</b>` : ''}. `
        + `<a href="/library/" target="_blank">Watch it in the library ↗</a>`
        + (ref ? ` <span class="dim">(${esc(String(ref))})</span>` : ''), 'ok');
    } catch (err) {
      say(row, `Could not queue — ${esc(err.message)}`, 'err');
      f.querySelector('button').disabled = false;
    }
  });
}

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { detail: txt.slice(0, 200) }; }
  if (!r.ok) throw new Error(data.detail || `${r.status} ${r.statusText}`);
  return data;
}

const esc = escapeHtml;

/* ─── citations: grouped by lesson, behind a collapsed receipt ───
 * Acolyte emits one card per PASSAGE. Retrieval routinely returns several
 * passages from the same lesson — and sometimes from the same section — so a
 * flat list repeats itself and buries the question actually worth answering:
 * which of my lessons taught me this?
 *
 * So the passages are regrouped by lesson (B) inside a one-line summary that
 * stays shut until asked (D). The original cards are kept in the DOM and
 * hidden: every pill delegates its click to the card it came from, so acolyte
 * keeps owning navigation and this cannot rot when its routing changes.
 */
function dressSources(msg) {
  const wrap = msg.querySelector('.acolyte-sources');
  if (!wrap || wrap.dataset.dressed) return;
  const cards = [...wrap.querySelectorAll('.src-card')];
  if (!cards.length) return;
  wrap.dataset.dressed = '1';

  const groups = new Map();
  for (const el of cards) {
    let s = {}; try { s = JSON.parse(el.dataset.acolyteSource || '{}'); } catch {}
    const m = s.meta || {};
    const key = m.lessonId || m.lesson || s.title || 'source';
    const g = groups.get(key) || { lesson: m.lesson || s.title || 'Source', domain: m.domain, n: 0, secs: [] };
    g.n++;
    // Titles are "<lesson> — <heading>"; the lesson name is already the row
    // heading, so the pill should carry only the part that differs.
    const head = (s.title || '').startsWith(g.lesson + ' — ')
      ? (s.title || '').slice(g.lesson.length + 3) : (m.section || 'section');
    if (!g.secs.some(x => x.label === head)) g.secs.push({ label: head, t: m.t, el });
    groups.set(key, g);
  }
  const gs = [...groups.values()];

  const list = document.createElement('div');
  list.className = 'ask-srcs';
  list.innerHTML = gs.map(g => `
    <div class="asrc">
      <div class="asrc-bar" data-dom="${escapeHtml(g.domain || '')}"></div>
      <div class="asrc-main">
        <div class="asrc-t">${escapeHtml(g.lesson)}
          ${g.domain ? `<span class="asrc-dm" data-dom="${escapeHtml(g.domain)}">${escapeHtml(DOMAIN_LABEL[g.domain] || g.domain)}</span>` : ''}
          ${g.n > g.secs.length ? `<span class="asrc-n">${g.n} passages</span>` : ''}
        </div>
        <div class="asrc-secs">${g.secs.map((s, i) =>
          `<button class="asrc-sec" data-g="${gs.indexOf(g)}" data-s="${i}">${
            s.t != null ? `▶ ${fmtTime(s.t)} · ` : ''}${escapeHtml(s.label)}</button>`).join('')}</div>
      </div>
    </div>`).join('');

  list.addEventListener('click', e => {
    const b = e.target.closest('.asrc-sec');
    if (b) gs[+b.dataset.g].secs[+b.dataset.s].el.click();   // acolyte still navigates
  });
  wrap.appendChild(list);

  // The strip: coverage first. Counting DISTINCT lessons is why this is script
  // and not a stylesheet — CSS cannot dedupe.
  const summary = wrap.querySelector('.src-summary');
  if (summary) {
    summary.innerHTML = `<span class="asrc-dots">${gs.map(g =>
      `<span class="asrc-dot" data-dom="${escapeHtml(g.domain || '')}"></span>`).join('')}</span>`
      + `Sourced from <b>${cards.length}</b> passage${cards.length === 1 ? '' : 's'} across `
      + `<b>${gs.length}</b> lesson${gs.length === 1 ? '' : 's'}`;
  }
  const count = wrap.querySelector('.src-count');
  if (count) count.remove();          // the sentence already says the number
}

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/* ─── thread history ───
 * Acolyte already persists every exchange to IndexedDB. The rail renders THAT,
 * via handle.history — not a parallel list of its own, which would drift from
 * the real conversation the moment either side changed.
 *
 * The one thing acolyte cannot know is which SCOPE a thread was asked under, so
 * that is kept here, keyed by conversation id, and used for the domain dot.
 */
const LS_TSCOPE = 'chiron.ask.thread-scope';

const scopeMap = () => { try { return JSON.parse(localStorage.getItem(LS_TSCOPE) || '{}'); } catch { return {}; } };
const rememberScope = (id, scope) => {
  if (!id) return;
  const m = scopeMap();
  if (m[id] === scope) return;
  m[id] = scope;
  try { localStorage.setItem(LS_TSCOPE, JSON.stringify(m)); } catch {}
};

function wireThreads(handle) {
  const paint = () => renderThreads(handle);
  handle.history.onChange(() => {
    rememberScope(handle.history.currentId(), $('#scope').value);
    paint();
  });
  paint();
}

/** Today / Earlier, newest first — the grouping the pilot used, because a bare
 *  list of 40 titles gives you no sense of when you were working on something. */
function bucket(ts) {
  const d = new Date(ts), now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= midnight) return 'Today';
  if (d.getTime() >= midnight - 6 * 864e5) return 'Earlier this week';
  return 'Older';
}

async function renderThreads(handle) {
  const box = $('#threads');
  let convos = [];
  try { convos = await handle.history.list(40); } catch { /* storage disabled or blocked */ }

  if (!convos.length) {
    box.innerHTML = '<div class="thempty">Your questions will collect here.</div>';
    return;
  }
  const cur = handle.history.currentId();
  const scopes = scopeMap();
  let html = '', seen = '';
  for (const c of convos) {
    const b = bucket(c.updatedAt);
    if (b !== seen) { html += `<h4>${b}</h4>`; seen = b; }
    const dom = scopes[c.id] || 'all';
    html += `<div class="throw${c.id === cur ? ' on' : ''}">
      <button class="th" data-id="${c.id}" title="${escapeHtml(new Date(c.updatedAt).toLocaleString())}">
        <span class="dot d-${escapeHtml(dom)}"></span>${escapeHtml(c.title || '…')}
      </button>
      <button class="thx" data-del="${c.id}" title="Delete this thread">×</button>
    </div>`;
  }
  box.innerHTML = html;

  box.onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      // No confirm dialog: acolyte keeps the conversation until this point, and
      // a thread is cheap to re-ask. A modal for every delete is worse friction
      // than the rare mistaken click.
      await handle.history.remove(+del.dataset.del);
      return;
    }
    const open = e.target.closest('.th[data-id]');
    if (open) {
      document.querySelector('#host .ask-hero')?.remove();
      await handle.history.open(+open.dataset.id);
    }
  };
}
