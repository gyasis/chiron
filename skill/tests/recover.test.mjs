// recover: the pending marker, the reply splitter, the markdown-lite renderer's escaping, and the recovery state machine
// driven the way the page drives it (visibilitychange / pageshow / online -> check()), with a mock fetch and fake DOM.
// Run: node --test skill/tests/recover.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, doc, tick } from './fake-dom.mjs';
import {
  PENDING_KEY, PENDING_TTL_MS, STALL_MS, savePending, readPending, clearPending, splitReply, renderMarkdownLite,
  renderRecoveredInto, createRecovery,
} from '../ask/recover.js';

const XSS = '<img src=x onerror=alert(1)>';
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const REPLY = '**1) Dov\'è l\'ambulatorio?**\nRegister: neutral.\n\n**How it\'s built**\n1. **è** (is)\n2. **dove è**\n\n**The pattern**\n`[q] è [noun]?`\n\n'
  + '\n\n[[SPEAK]]Dov\'è l\'ambulatorio?[[/SPEAK]]\n\n```phrase\n{"it":"Dov\'è l\'ambulatorio?","items":[{"it":"Dov\'è l\'ambulatorio?"}]}\n```\n\n```diagram\n{"sentences":[]}\n```';

test('pending marker: save, read, clear, and a corrupt value reads as none', () => {
  const s = store();
  assert.equal(readPending(s), null);
  savePending(s, { text: 'how do I say hi', session: 'tab', started_at: 5 });
  assert.deepEqual(readPending(s), { text: 'how do I say hi', session: 'tab', started_at: 5 });
  s.setItem(PENDING_KEY, '{nope');
  assert.equal(readPending(s), null);
  s.setItem(PENDING_KEY, JSON.stringify({ text: 1 }));
  assert.equal(readPending(s), null);
  savePending(s, { text: 'x', session: 's', started_at: 1 });
  clearPending(s);
  assert.equal(readPending(s), null);
  assert.doesNotThrow(() => savePending({ setItem() { throw new Error('blocked'); } }, { text: 'x', started_at: 1 }));
});

test('splitReply drops the hidden blocks and returns the spoken text', () => {
  const { text, speak } = splitReply(REPLY);
  assert.equal(speak, "Dov'è l'ambulatorio?");
  assert.ok(!text.includes('```') && !text.includes('SPEAK'));
  assert.ok(text.includes('How it\'s built'));
});

test('markdown-lite renders text, never markup', () => {
  const root = renderMarkdownLite(doc, `**Bold ${XSS}**\nline two with \`code\` and *em*\n\n1. first ${XSS}\n2. second\n\n- a\n- b`);
  assert.equal(root.all(n => n.tagName === 'IMG').length, 0);
  assert.ok(root.textContent.includes(XSS));
  assert.equal(root.all(n => n.tagName === 'STRONG').length, 1);
  assert.equal(root.all(n => n.tagName === 'CODE')[0].textContent, 'code');
  assert.equal(root.all(n => n.tagName === 'OL')[0].children.length, 2);
  assert.equal(root.all(n => n.tagName === 'UL')[0].children.length, 2);
  assert.equal(root.all(n => n.tagName === 'BR').length, 1);
});

function mkBox({ interrupted = true, userText = 'how do I say hi' } = {}) {
  const box = new Node('div');
  const u = new Node('div'); u.className = 'acolyte-msg user'; u.dataset.raw = userText;
  const ub = new Node('div'); ub.className = 'acolyte-msg-body'; ub.textContent = userText; u.appendChild(ub);
  box.appendChild(u);
  if (interrupted) {
    const a = new Node('div'); a.className = 'acolyte-msg assistant'; a.dataset.streaming = '1'; a.dataset.acts = '1';
    const ab = new Node('div'); ab.className = 'acolyte-msg-body'; ab.textContent = 'partial';
    const err = new Node('div'); err.className = 'acolyte-error'; err.textContent = '⚠ Answer interrupted';
    const old = new Node('div'); old.className = 'ask-coach-extras'; old.textContent = 'stale';
    a.appendChild(ab); a.appendChild(err); a.appendChild(old);
    box.appendChild(a);
  }
  return box;
}

test('recovered answer replaces the interrupted bubble, adds no second user bubble, and runs the normal binding once', () => {
  const box = mkBox();
  const bound = [], spoken = [];
  const msg = renderRecoveredInto(doc, box, REPLY, { text: 'how do I say hi' }, { bind: m => bound.push(m), speak: t => spoken.push(t) });
  assert.equal(box.children.length, 2, 'one user bubble and one assistant bubble');
  assert.equal(box.children.filter(c => c.className.includes('user')).length, 1);
  assert.equal(msg, box.children[1]);
  assert.equal(msg.children.length, 1, 'the interrupted notice, old actions and old extras are gone');
  assert.ok(msg.textContent.includes('How it\'s built'));
  assert.ok(msg.textContent.includes('Recovered after the connection dropped.'));
  assert.ok(!msg.textContent.includes('```') && !msg.textContent.includes('SPEAK'));
  assert.equal(msg.dataset.streaming, undefined);
  assert.equal(msg.dataset.acts, undefined);
  assert.equal(msg.dataset.phraseBound, '1');
  assert.equal(msg.dataset.raw, REPLY, 'the raw reply is kept for the phrase / diagram / related binding');
  assert.deepEqual(bound, [msg]);
  assert.deepEqual(spoken, [], 'a recovered answer is never spoken on its own');
  const listen = msg.all(n => n.className === 'ask-recovered-listen')[0];
  assert.ok(listen, 'a Listen button stays available');
  listen.click();
  assert.deepEqual(spoken, ["Dov'è l'ambulatorio?"], 'tapping Listen speaks the [[SPEAK]] text');
});

test('a reload leaves an empty thread: the question and the answer are both created, once', () => {
  const box = new Node('div');
  let hero = 0;
  renderRecoveredInto(doc, box, REPLY, { text: 'how do I say hi' }, { onFirstBubble: () => hero++ });
  assert.deepEqual(box.children.map(c => c.className), ['acolyte-msg user', 'acolyte-msg assistant']);
  assert.equal(hero, 1);
  renderRecoveredInto(doc, box, REPLY, { text: 'how do I say hi' }, {});         // a second render reuses both bubbles
  assert.equal(box.children.length, 2);
});

test('recovered text is rendered as text', () => {
  const box = mkBox();
  const msg = renderRecoveredInto(doc, box, `**Hi ${XSS}**`, { text: 'how do I say hi' }, {});
  assert.equal(msg.all(n => n.tagName === 'IMG').length, 0);
  assert.ok(msg.textContent.includes(XSS));
});

function harness({ state = 'interrupted', run = { status: 'done', content_so_far: REPLY, user: 'how do I say hi', elapsed_s: 70 }, ok = true, status = 200, start = 1000 } = {}) {
  const s = store();
  savePending(s, { text: 'how do I say hi', session: 'tab', started_at: start });
  const h = { s, now: start + 60000, fetched: [], rendered: [], statuses: [], timers: [], state, run, ok, status, lastChange: 0 };
  h.rec = createRecovery({
    storage: s, now: () => h.now, session: () => 'tab', lastChangeAt: () => h.lastChange,
    replyState: () => h.state,
    fetchFn: async (url, init) => { h.fetched.push([url, init]); if (h.offline) throw new TypeError('offline'); return { ok: h.ok, status: h.status, json: async () => h.run }; },
    render: (content, p) => h.rendered.push([content, p.text]), status: t => h.statuses.push(t),
    setTimer: (f, ms) => { h.timers.push([f, ms]); return h.timers.length; }, clearTimer: () => {},
  });
  return h;
}

test('visibilitychange with an interrupted reply fetches the run and renders it once', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.rec.check(), h.rec.check()]);            // visibilitychange + pageshow together
  assert.deepEqual([a, b].sort(), ['busy', 'recovered']);
  assert.equal(h.rendered.length, 1);
  assert.equal(h.rendered[0][0], REPLY);
  assert.equal(h.fetched[0][0], '/ask/phrase/run/latest');
  assert.equal(h.fetched[0][1].headers['X-Ask-Session'], 'tab');
  assert.equal(readPending(h.s), null, 'the marker is cleared');
  assert.equal(await h.rec.check(), 'none');
  assert.equal(h.rendered.length, 1, 'later events render nothing more');
});

test('a missing reply and a stalled stream are recovered; a live stream and a complete reply are left alone', async () => {
  let h = harness({ state: 'missing' });
  assert.equal(await h.rec.check(), 'recovered');
  h = harness({ state: 'streaming' });
  h.lastChange = h.now - 1000;                                                 // changed a second ago: alive
  assert.equal(await h.rec.check(), 'live');
  assert.equal(h.fetched.length, 0);
  h = harness({ state: 'streaming' });
  h.lastChange = h.now - STALL_MS - 1;                                         // frozen
  assert.equal(await h.rec.check(), 'recovered');
  h = harness({ state: 'complete' });
  assert.equal(await h.rec.check(), 'complete');
  assert.equal(h.fetched.length, 0);
  assert.equal(readPending(h.s), null);
});

test('a run still working shows "Still working… (Ns)" and polls until it is done', async () => {
  const h = harness({ run: { status: 'running', content_so_far: '**1) ', user: 'how do I say hi', elapsed_s: 12 } });
  assert.equal(await h.rec.check(), 'running');
  assert.deepEqual(h.statuses, ['Still working… (12s)']);
  assert.equal(h.timers.length, 1);
  assert.equal(h.rendered.length, 0);
  h.run = { status: 'done', content_so_far: REPLY, user: 'how do I say hi', elapsed_s: 80 };
  await h.timers[0][0]();                                                      // the poll fires
  await tick();
  assert.equal(h.rendered.length, 1);
  assert.equal(h.statuses[h.statuses.length - 1], null, 'the status line is cleared');
  assert.equal(readPending(h.s), null);
});

test('other outcomes: expired marker, another request, no run, server error, offline, failed run', async () => {
  let h = harness();
  h.now += PENDING_TTL_MS;
  assert.equal(await h.rec.check(), 'expired');
  assert.equal(readPending(h.s), null);
  h = harness({ run: { status: 'done', content_so_far: 'x', user: 'something else', elapsed_s: 1 } });
  assert.equal(await h.rec.check(), 'other');
  assert.equal(h.rendered.length, 0);
  h = harness({ ok: false, status: 404 });
  assert.equal(await h.rec.check(), 'unknown');
  h = harness({ ok: false, status: 500 });
  assert.equal(await h.rec.check(), 'unknown');
  assert.equal(h.timers.length, 1, 'a server error is retried');
  h = harness();
  h.offline = true;
  assert.equal(await h.rec.check(), 'offline');
  assert.equal(h.timers.length, 1, 'offline: retried later (and on the online event)');
  assert.notEqual(readPending(h.s), null, 'the marker stays until the answer is collected');
  h = harness({ run: { status: 'error', error: 'RuntimeError: build failed', content_so_far: '', user: 'how do I say hi', elapsed_s: 5 } });
  assert.equal(await h.rec.check(), 'failed');
  assert.match(h.statuses[h.statuses.length - 1], /could not be finished: RuntimeError: build failed/);
});
