// running — the "N running" pill. Run: node --test skill/tests/running.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Node, doc } from './fake-dom.mjs';
import { mountRunning, pillText, clock, BUSY_MS, IDLE_MS } from '../ask/running.js';

const flush = () => new Promise(r => setTimeout(r, 0));

test('pill text and clock', () => {
  assert.equal(pillText({ count: 2, recent: [] }), '⏳ 2 running');
  assert.equal(pillText({ count: 0, recent: [{}] }), '✓ 1 finished');
  assert.equal(pillText({ count: 0, recent: [] }), '');
  assert.equal(clock(42), '42 s');
  assert.equal(clock(185), '3 min 5 s');
  assert.equal(clock(3725), '1 h 2 min');
});

test('lists each running job with its time, polls fast while busy and slow when idle', async () => {
  const host = new Node('div'); const delays = []; let t = 1000;
  let reply = { count: 1, at: 0, recent: [], items: [{ kind: 'pimsleur', id: 'p', title: 'Coach phrases', detail: 'planning', elapsed_s: 65, link: '/library/' }] };
  const r = mountRunning(doc, host, { fetchJson: async () => ({ ...reply }), setTimer: (f, ms) => { delays.push(ms); return 1; }, clearTimer: () => {}, now: () => t });
  await flush(); await flush();
  const [pill, list] = r.el.children;
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, '⏳ 1 running');
  assert.match(list.textContent, /🎧 Coach phrases/);
  assert.match(list.textContent, /planning · 1 min 5 s/);
  assert.equal(delays[0], BUSY_MS);
  t = 1010; r.render();
  assert.match(list.textContent, /1 min 15 s/, 'counts up between polls');
  reply = { count: 0, recent: [], items: [] };
  await r.refresh();
  assert.equal(pill.hidden, true, 'nothing running, nothing recent: no pill');
});

test('a server that cannot be reached keeps the last list and says why on hover', async () => {
  const host = new Node('div');
  const r = mountRunning(doc, host, { fetchJson: async () => { throw new Error('HTTP 502'); }, setTimer: () => 1, clearTimer: () => {}, now: () => 0 });
  await flush(); await flush();
  assert.match(r.el.children[0].title, /HTTP 502/);
  assert.equal(r.el.children[0].hidden, true);
});
