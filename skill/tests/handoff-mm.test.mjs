// The phone's Riprendi banner (chiron-tauri/mobile/handoff.js) when the computer hands over a ready Match Madness set:
// it pulses, says what is ready, and "▶ Gioca" opens the Match Madness app on that collection. Without a set it stays the
// plain "Riprendi" banner. Run: node --test skill/tests/handoff-mm.test.mjs   (plain browser script under small fakes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC = readFileSync(new URL('../chiron-tauri/mobile/handoff.js', import.meta.url), 'utf8');
const BASE = 'http://192.168.0.146:8911';

function el(id) {
  const e = { id, style: {}, children: [], classes: new Set(), byId: {}, onclick: null,
    attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    classList: { toggle: (c, on) => (on ? e.classes.add(c) : e.classes.delete(c)), contains: c => e.classes.has(c) },
    querySelector(sel) { return this.byId[sel.replace(/^#/, '')] || null; } };
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html || ''; },
    set(h) { e._html = h; e.byId = {}; for (const m of h.matchAll(/id="([\w-]+)"/g)) e.byId[m[1]] = el(m[1]); } });
  return e;
}

function load(slot) {
  const rows = el('rows'), opened = [], toasts = [], store = {};
  rows.parentNode = { insertBefore: n => { rows.banner = n; } };
  const doc = { head: { appendChild() {} }, hidden: false, addEventListener() {},
    createElement: t => el(t), getElementById: id => (id === 'rows' ? rows : null) };
  const win = { addEventListener() {} };
  const ctx = {
    window: win, document: doc, console, URLSearchParams, Date, Promise, String, Math, JSON, encodeURIComponent,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: () => 0, setInterval: () => 0,
    fetch: async () => ({ ok: true, json: async () => ({ entries: slot }) }),
    askBase: () => BASE, LESSONS: [], OPEN_SLUG: null, slugOf: s => s, toast: t => toasts.push(t),
    openLesson: (...a) => opened.push(['lesson', ...a]),
    TAURI: true, invoke: async (cmd, a) => opened.push([cmd, a.url]),
  };
  win.ChironOpen = null;
  runInNewContext(SRC, ctx);
  return { api: win.ChironHandoff, rows, opened, toasts };
}

const now = () => Date.now() - 60000;

test('a hand-off with a Match Madness set: pulsing banner, ▶ Gioca opens the app on that collection', async () => {
  const p = { lesson: 'chiron-pod101-chilling-01-salute-e-corpo', title: 'Salute e corpo', ts: now(), from: 'web',
              mm: { id: 'salute-e-corpo', name: 'Salute e corpo', count: 15 } };
  const { api, rows, opened } = load({ pin: { v: p, t: p.ts } });
  await api.poll();
  const b = rows.banner;
  assert.ok(b, 'banner shown');
  assert.ok(b.classList.contains('hf-mm'), 'pulses');
  assert.match(b.innerHTML, /Match Madness pronto/);
  assert.match(b.innerHTML, /15 coppie/);
  assert.match(b.innerHTML, /Dal computer/);
  b.querySelector('#hf-mm').onclick();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(opened, [['plugin:opener|open_url',
    'matchmadness://raccolta?id=salute-e-corpo&chiron=' + encodeURIComponent(BASE)]]);
  assert.equal(b.style.display, 'none', 'answered: banner hides');
});

test('"Lezione" on the same banner still reopens the lesson', async () => {
  const p = { lesson: 'L', title: 'T', anchor: 'parole', ts: now(), from: 'web', mm: { id: 'x', name: 'T', count: 3 } };
  const { api, rows, opened } = load({ pin: { v: p, t: p.ts } });
  await api.poll();
  rows.banner.querySelector('#hf-go').onclick();
  assert.deepEqual(opened, [['lesson', 'L', '#parole', 'L']]);
});

test('without a set it is the plain Riprendi banner, no pulse', async () => {
  const p = { lesson: 'L', title: 'Una lezione', ts: now(), from: 'web' };
  const { api, rows } = load({ cur: { v: p, t: p.ts } });
  await api.poll();
  assert.ok(!rows.banner.classList.contains('hf-mm'));
  assert.match(rows.banner.innerHTML, /Riprendi/);
  assert.equal(rows.banner.querySelector('#hf-mm'), null);
});
