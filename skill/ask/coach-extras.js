/*
 * Chiron · Ask — everything the phrase coach adds UNDER its reply, built outside acolyte's sanitised markdown.
 *
 *   parseFenceBlock(raw, tag)   the hidden `diagram` / `related` JSON blocks of a reply
 *   buildDiagram(doc, data)     the word-by-word sentence diagram with its layer toggles
 *   buildRelated(...)           "Study more": lessons found + topics with no lesson yet (+ a "Make a lesson" button)
 *   buildPimsleurAction(...)    "Make a Pimsleur lesson from these N phrases", with an inline confirm
 *   createBasket(...)           the Pimsleur basket: phrases collected over time, stored server-side in Raccolte
 *
 * Every piece of model or server text goes in through textContent, never innerHTML. `doc` is the Document (injected so
 * the tests can pass a fake one); network calls go through the injected `api`.
 */

const FENCE = tag => new RegExp('```' + tag + '[^\\S\\n]*\\n([\\s\\S]*?)```', 'i');

/** Pull a fenced JSON block out of a reply's raw text. Returns { ok, data } or { ok:false, reason }; never throws. */
export function parseFenceBlock(raw, tag) {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'empty reply' };
  const m = FENCE(tag).exec(raw);
  if (!m) return { ok: false, reason: `no ${tag} block in reply` };
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return { ok: false, reason: `${tag} block is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: `${tag} block is not a JSON object` };
  if (tag === 'diagram' && !(Array.isArray(data.sentences) && data.sentences.length)) return { ok: false, reason: 'diagram block has no sentences' };
  return { ok: true, data };
}

/** Only same-site paths become links: a model- or server-supplied "javascript:" or "//host" is dropped. */
export function safeHref(u) {
  return typeof u === 'string' && /^\/(?!\/)[^\s]*$/.test(u) ? u : null;
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

const TAGS = { articles: 'art', nouns: 'n', verbs: 'v', adverbs: 'adv', preps: 'prep', pronouns: 'pron' };

/* ─── the sentence diagram ─── */

/** The diagram element for an AnnotatedPassage document. */
export function buildDiagram(doc, data) {
  const root = el(doc, 'section', 'ask-dg');
  root.setAttribute('aria-label', 'Sentence diagram');
  root.appendChild(el(doc, 'div', 'dg-title', 'Sentence diagram'));
  const bar = el(doc, 'div', 'dg-toggles');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Diagram layers');
  for (const l of data.layers || []) {
    const key = String(l.key);
    const on = l.defaultOn !== false;
    const b = el(doc, 'button', 'dg-layer');
    b.type = 'button';
    b.dataset.layer = key;
    b.setAttribute('aria-pressed', String(on));
    b.appendChild(el(doc, 'span', 'dg-dot'));
    b.appendChild(el(doc, 'span', '', l.label));
    if (!on) root.classList.add('dg-hide-' + key);
    b.addEventListener('click', () => {
      const off = root.classList.toggle('dg-hide-' + key);
      b.setAttribute('aria-pressed', String(!off));
    });
    bar.appendChild(b);
  }
  root.appendChild(bar);
  for (const s of data.sentences || []) {
    const box = el(doc, 'div', 'dg-sent');
    const text = el(doc, 'p', 'dg-text', s.text);
    text.lang = 'it';
    box.appendChild(text);
    const sub = (cls, label, value) => {
      if (!value) return;
      const d = el(doc, 'div', 'dg-sub ' + cls);
      d.appendChild(el(doc, 'span', 'dg-lab', label));
      d.appendChild(doc.createTextNode(' ' + value));
      box.appendChild(d);
    };
    sub('dg-l-translation', 'translation', s.translation);
    sub('dg-l-literal', 'word for word', s.literal);
    sub('dg-l-register', 'register', s.registerNote);
    const toks = el(doc, 'div', 'dg-tokens');
    const note = el(doc, 'div', 'dg-note', 'Tap or focus a word to see what it is.');
    note.setAttribute('aria-live', 'polite');
    for (const t of s.tokens || []) {
      const b = el(doc, 'button', 'dg-tok');
      b.type = 'button';
      b.dataset.layer = String(t.layer);
      b.appendChild(el(doc, 'span', 'dg-surf', t.surface));
      b.appendChild(el(doc, 'sup', 'dg-tag', TAGS[t.layer] || t.layer));
      const show = () => {
        const feats = t.features ? Object.entries(t.features).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
        const head = [t.lemma && t.lemma !== t.surface ? `${t.surface} ← ${t.lemma}` : t.surface, t.pos].filter(Boolean).join(' · ');
        note.textContent = `${head}${feats ? ' (' + feats + ')' : ''} — ${t.note}`;
        for (const o of toks.children) o.classList.toggle('dg-on', o === b);
      };
      b.addEventListener('click', show);
      b.addEventListener('focus', show);
      b.addEventListener('mouseenter', show);
      toks.appendChild(b);
    }
    box.appendChild(toks);
    box.appendChild(note);
    if (s.phrases && s.phrases.length) {
      const ph = el(doc, 'div', 'dg-phrases dg-l-phrases');
      for (const p of s.phrases) {
        const c = el(doc, 'span', 'dg-phrase');
        c.appendChild(el(doc, 'b', '', p.surface));
        c.appendChild(doc.createTextNode(` — ${p.meaning}${p.note ? ' (' + p.note + ')' : ''}`));
        ph.appendChild(c);
      }
      box.appendChild(ph);
    }
    if (s.tips && s.tips.length) {
      const ul = el(doc, 'ul', 'dg-tips');
      for (const t of s.tips) ul.appendChild(el(doc, 'li', '', t));
      box.appendChild(ul);
    }
    root.appendChild(box);
  }
  return root;
}

/* ─── "Study more" ─── */

/** What the /generate reply means, in words. A duplicate is never "Queued". */
export function describeGenerate(r) {
  if (r && r.duplicate) {
    const ready = r.status === 'ready' || r.status === 'published' || r.lesson_url;
    return ready
      ? { text: 'This lesson already exists.', href: safeHref(r.lesson_url || (r.slug ? `/lessons/${r.slug}/lesson.html` : '')) || '/library/', link: 'Open it' }
      : { text: 'Already exists: this lesson is already being generated.', href: '/library/', link: 'Watch it in the library' };
  }
  return { text: `Queued${r && r.slug ? ' (' + r.slug + ')' : ''}.`, href: '/library/', link: 'Watch it in the library' };
}

function statusLine(doc, row, d, kind) {
  let s = row.querySelector('.act-status');
  if (!s) { s = el(doc, 'span', 'act-status'); row.appendChild(s); }
  s.className = 'act-status ' + (kind || '');
  s.textContent = d.text + ' ';
  const href = safeHref(d.href);
  if (href) {
    const a = el(doc, 'a', '', d.link || 'Open');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    s.appendChild(a);
  }
}

/** "Study more": `data` is {lessons:[{title,url,topic,section?}], missing:[topic]}; `generate(topic)` POSTs /generate. */
export function buildRelated(doc, data, generate) {
  const root = el(doc, 'section', 'ask-rel');
  root.setAttribute('aria-label', 'Study more');
  root.appendChild(el(doc, 'div', 'rel-title', 'Study more'));
  if ((data.lessons || []).length) {
    const ul = el(doc, 'ul', 'rel-list');
    for (const l of data.lessons) {
      const li = el(doc, 'li', 'rel-item');
      const href = safeHref(l.url);
      const a = href ? el(doc, 'a', 'rel-link', l.title) : el(doc, 'span', 'rel-link', l.title);
      if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
      li.appendChild(a);
      li.appendChild(el(doc, 'span', 'rel-topic', l.topic));
      if (l.section) li.appendChild(el(doc, 'span', 'rel-sec', l.section));
      ul.appendChild(li);
    }
    root.appendChild(ul);
  }
  if ((data.missing || []).length) {
    root.appendChild(el(doc, 'div', 'rel-sub', 'No lesson yet'));
    const ul = el(doc, 'ul', 'rel-list');
    for (const topic of data.missing) {
      const li = el(doc, 'li', 'rel-item');
      li.appendChild(el(doc, 'span', 'rel-miss', topic));
      const b = el(doc, 'button', 'rel-make', `Make a lesson on ${topic}`);
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        statusLine(doc, li, { text: 'Queueing…' });
        try {
          statusLine(doc, li, describeGenerate(await generate(topic)), 'ok');
        } catch (e) {
          b.disabled = false;
          statusLine(doc, li, { text: `Could not queue: ${e && e.message || e}` }, 'err');
        }
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
    root.appendChild(ul);
  }
  return root;
}

/* ─── Pimsleur ─── */

const words = (t, n) => String(t || '').trim().replace(/[?.!]+$/, '').split(/\s+/).slice(0, n).join(' ');

/** A short theme from the first phrases (the server derives the same way when the topic is left empty). */
export function deriveTopic(phrases) {
  return 'Coach phrases: ' + phrases.slice(0, 3).map(p => words(p.en || p.it, 5)).join('; ');
}

/** What the /api/pimsleur/from-phrases reply means, in words. A duplicate is never "Queued". */
export function describePimsleur(r) {
  const warn = r && r.warning ? ` ${r.warning}` : '';
  if (r && r.duplicate) return { text: 'This Pimsleur lesson already exists.' + warn, href: safeHref(r.url) || '/library/', link: 'Open it', duplicate: true };
  return { text: `Queued a Pimsleur season on "${r && r.topic || ''}".${warn}`, href: safeHref(r && r.url) || '/library/', link: 'Watch it in the library', duplicate: false };
}

function phraseList(doc, phrases) {
  const ul = el(doc, 'ul', 'px-list');
  for (const p of phrases) {
    const li = el(doc, 'li', '');
    li.appendChild(el(doc, 'strong', '', p.it));
    if (p.en) li.appendChild(el(doc, 'span', 'px-en', p.en));
    if (p.register) li.appendChild(el(doc, 'span', 'px-reg', p.register));
    ul.appendChild(li);
  }
  return ul;
}

/** The shortcut button on a reply. `send(body)` POSTs the route. */
export function buildPimsleurAction(doc, phrases, send) {
  const row = el(doc, 'div', 'px-action');
  const label = phrases.length === 1 ? 'this phrase' : `these ${phrases.length} phrases`;
  const btn = el(doc, 'button', 'px-open', `🎧 Make a Pimsleur lesson from ${label}`);
  btn.type = 'button';
  row.appendChild(btn);
  btn.addEventListener('click', () => {
    if (row.querySelector('.px-confirm')) return;
    const box = el(doc, 'div', 'px-confirm');
    box.appendChild(phraseList(doc, phrases));
    const topic = el(doc, 'input', 'px-topic');
    topic.value = deriveTopic(phrases);
    topic.setAttribute('aria-label', 'Season topic');
    box.appendChild(topic);
    box.appendChild(el(doc, 'p', 'px-note', 'Generation + audio bake on the Mac Studio, takes a while.'));
    const go = el(doc, 'button', 'px-go', 'Generate');
    const no = el(doc, 'button', 'px-no', 'Cancel');
    go.type = no.type = 'button';
    no.addEventListener('click', () => box.remove());
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const r = await send({ phrases, topic: topic.value.trim() || undefined, confirm: true });
        box.remove();
        const d = describePimsleur(r);
        statusLine(doc, row, d, d.duplicate ? '' : 'ok');
      } catch (e) {
        go.disabled = false;
        statusLine(doc, box, { text: `Could not start: ${e && e.message || e}` }, 'err');
      }
    });
    box.appendChild(go);
    box.appendChild(no);
    row.appendChild(box);
  });
  return row;
}

/* ─── the basket ─── */

export const BASKET_ID = 'pimsleur-basket';
export const BASKET_TARGET = 8;
export const BASKET_MIN = 3;
const regOf = note => (/register:(lei|tu|neutral)/.exec(note || '') || [])[1] || '';
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/^[ .,;:!?«»"']+|[ .,;:!?«»"']+$/g, '');

/**
 * The basket controller + its panel. `api(method, path, body)` returns parsed JSON or throws.
 * The pill (`pill`) shows "🎧 Basket n/8"; `panel` is the sheet it opens. Items live in the server's Raccolte collection.
 */
export function createBasket({ doc, api, pill, panel, target = BASKET_TARGET, onChange = () => {} }) {
  const st = { items: [], open: false, topic: '', dirty: false, mode: 'list', msg: null };
  const listeners = new Set();
  const base = `/api/collections/${BASKET_ID}`;

  const ctl = {
    el: panel,
    get items() { return st.items; },
    has: it => st.items.some(i => fold(i.it) === fold(it)),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    async refresh() {
      const d = await api('GET', base);
      st.items = (d.items || []).map(i => ({ it: i.it, en: i.en || '', register: regOf(i.note) }));
      if (!st.dirty) st.topic = st.items.length ? deriveTopic(st.items) : '';
      changed();
    },
    async add(phrases) {
      const fresh = phrases.filter(p => !ctl.has(p.it));
      if (!fresh.length) return 0;
      await api('POST', base + '/items', { items: fresh.map(p => ({ it: p.it, en: p.en || '', source: 'ask-phrase', note: p.register ? `register:${p.register}` : '' })) });
      await ctl.refresh();
      toast(fresh.length === 1 ? 'Added to the basket' : `Added ${fresh.length} to the basket`);
      return fresh.length;
    },
    async remove(it) {
      await api('DELETE', `${base}/items?it=${encodeURIComponent(it)}`);
      await ctl.refresh();
    },
    async toggle(p) { return ctl.has(p.it) ? ctl.remove(p.it) : ctl.add([p]); },
    setOpen(v) { st.open = v; render(); },
  };

  function changed() { render(); for (const f of listeners) f(); onChange(ctl); }

  function toast(text) {
    st.msg = { text, kind: 'toast' };
    render();
    setTimeout(() => { if (st.msg && st.msg.text === text) { st.msg = null; render(); } }, 2500);
  }

  function render() {
    const n = st.items.length;
    pill.textContent = `🎧 Basket ${n}/${target}`;
    pill.setAttribute('aria-expanded', String(st.open));
    panel.hidden = !st.open;
    panel.textContent = '';
    if (!st.open) return;
    const head = el(doc, 'div', 'bk-head');
    head.appendChild(el(doc, 'strong', '', 'Pimsleur basket'));
    head.appendChild(el(doc, 'span', 'bk-count', `${n} of ${target}`));
    const close = el(doc, 'button', 'bk-x', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the basket');
    close.addEventListener('click', () => ctl.setOpen(false));
    head.appendChild(close);
    panel.appendChild(head);
    const bar = el(doc, 'div', 'bk-bar');
    const fill = el(doc, 'div', 'bk-fill');
    fill.style.width = `${Math.min(100, Math.round(100 * n / target))}%`;
    bar.appendChild(fill);
    panel.appendChild(bar);
    panel.appendChild(el(doc, 'p', 'bk-hint', n < BASKET_MIN
      ? `Add at least ${BASKET_MIN} phrases; 6 to 10 that belong together make a good season.`
      : n < 6 ? 'You can generate now; 6 to 10 phrases make a fuller season.'
      : n <= 10 ? 'A good size for a season.' : 'More than 10 will make a long season.'));
    if (st.msg) {
      const m = el(doc, 'div', 'bk-msg ' + st.msg.kind, st.msg.text);
      if (st.msg.href) {
        const a = el(doc, 'a', 'bk-link', st.msg.link || 'Open');
        a.href = st.msg.href; a.target = '_blank'; a.rel = 'noopener';
        m.appendChild(doc.createTextNode(' '));
        m.appendChild(a);
      }
      panel.appendChild(m);
    }
    const ul = el(doc, 'ul', 'bk-list');
    for (const p of st.items) {
      const li = el(doc, 'li', '');
      const t = el(doc, 'div', 'bk-t');
      t.appendChild(el(doc, 'strong', '', p.it));
      if (p.en) t.appendChild(el(doc, 'span', 'px-en', p.en));
      if (p.register) t.appendChild(el(doc, 'span', 'px-reg', p.register));
      li.appendChild(t);
      const x = el(doc, 'button', 'bk-rm', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${p.it}`);
      x.addEventListener('click', () => run(() => ctl.remove(p.it)));
      li.appendChild(x);
      ul.appendChild(li);
    }
    if (!n) ul.appendChild(el(doc, 'li', 'bk-empty', 'Empty. Use ➕ under a phrase reply to collect phrases.'));
    panel.appendChild(ul);
    if (st.mode === 'generate' || st.mode === 'clear') return panel.appendChild(confirmBox());
    const topic = el(doc, 'input', 'bk-topic');
    topic.value = st.topic;
    topic.placeholder = 'Season topic';
    topic.setAttribute('aria-label', 'Season topic');
    topic.addEventListener('input', () => { st.topic = topic.value; st.dirty = true; });
    panel.appendChild(topic);
    const acts = el(doc, 'div', 'bk-acts');
    const gen = el(doc, 'button', 'bk-gen', 'Generate Pimsleur lesson');
    gen.type = 'button';
    gen.disabled = n < BASKET_MIN;
    gen.addEventListener('click', () => { st.mode = 'generate'; render(); });
    const clr = el(doc, 'button', 'bk-clear', 'Clear basket');
    clr.type = 'button';
    clr.disabled = !n;
    clr.addEventListener('click', () => { st.mode = 'clear'; render(); });
    acts.appendChild(gen);
    acts.appendChild(clr);
    panel.appendChild(acts);
  }

  function confirmBox() {
    const gen = st.mode === 'generate';
    const box = el(doc, 'div', 'bk-confirm');
    box.appendChild(el(doc, 'p', 'px-note', gen
      ? `Generate a Pimsleur season on "${st.topic.trim() || deriveTopic(st.items)}" from these ${st.items.length} phrases? Generation + audio bake on the Mac Studio, takes a while.`
      : `Remove all ${st.items.length} phrases from the basket?`));
    const go = el(doc, 'button', 'px-go', gen ? 'Generate' : 'Clear');
    const no = el(doc, 'button', 'px-no', 'Back');
    go.type = no.type = 'button';
    no.addEventListener('click', () => { st.mode = 'list'; render(); });
    go.addEventListener('click', async () => {
      go.disabled = true;
      await run(gen ? generate : clear);
    });
    box.appendChild(go);
    box.appendChild(no);
    return box;
  }

  async function generate() {
    const r = await api('POST', '/api/pimsleur/from-phrases', { collection: BASKET_ID, topic: st.topic.trim() || undefined, confirm: true });
    st.mode = 'list';
    const d = describePimsleur(r);
    if (!d.duplicate) { st.dirty = false; await ctl.refresh(); }     // the items moved to the season's collection
    st.msg = { text: d.text, kind: d.duplicate ? 'dup' : 'ok', href: d.href, link: d.link };
    render();
  }

  async function clear() {
    for (const p of [...st.items]) await api('DELETE', `${base}/items?it=${encodeURIComponent(p.it)}`);
    st.mode = 'list'; st.dirty = false;
    await ctl.refresh();
  }

  async function run(fn) {
    try { await fn(); } catch (e) { st.mode = 'list'; st.msg = { text: `Could not do that: ${e && e.message || e}`, kind: 'err' }; render(); }
  }

  pill.addEventListener('click', () => ctl.setOpen(!st.open));
  render();
  return ctl;
}

/** The ➕ row under a reply: one button per phrase plus "Add all N". Buttons follow the basket (➕ / ✓) as it changes. */
export function buildAddRow(doc, basket, phrases) {
  const row = el(doc, 'div', 'bk-add');
  const btns = [];
  const paint = () => { for (const [b, p] of btns) { const inb = basket.has(p.it); b.textContent = inb ? '✓' : '➕'; b.setAttribute('aria-pressed', String(inb)); b.title = inb ? 'In the basket: click to remove' : 'Add to basket'; } all.disabled = phrases.every(p => basket.has(p.it)); };
  const fail = e => { row.dataset.error = String(e && e.message || e); };
  for (const p of phrases) {
    const item = el(doc, 'div', 'bk-add-item');
    const b = el(doc, 'button', 'bk-plus');
    b.type = 'button';
    b.addEventListener('click', () => basket.toggle(p).catch(fail));
    item.appendChild(b);
    item.appendChild(el(doc, 'span', 'bk-add-it', p.it));
    row.appendChild(item);
    btns.push([b, p]);
  }
  const all = el(doc, 'button', 'bk-all', phrases.length === 1 ? '➕ Add to basket' : `➕ Add all ${phrases.length}`);
  all.type = 'button';
  all.addEventListener('click', () => basket.add(phrases).catch(fail));
  row.insertBefore(all, row.firstChild);
  basket.subscribe(paint);
  paint();
  return row;
}
