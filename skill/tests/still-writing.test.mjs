// still-writing — the page-owned status line that keeps counting while a phrase reply streams.
// Run: node --test skill/tests/still-writing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Node, doc } from './fake-dom.mjs';
import { stillWriting } from '../ask/still-writing.js';

function mk() {
  const msg = new Node('div'); msg.className = 'acolyte-msg assistant'; msg.dataset.streaming = '1';
  const body = new Node('div'); body.className = 'acolyte-msg-body'; msg.appendChild(body);
  return msg;
}

test('counts from the send time while streaming, then shows the final total and stops', () => {
  const msg = mk(); let t = 10000, ticks = 0;
  const w = stillWriting(doc, msg, 0, { now: () => t, setTimer: () => 7, clearTimer: () => { ticks++; } });
  assert.equal(msg.children[0], w.el, 'sits above the reply body');
  assert.equal(w.el.textContent, 'still writing… 10 s');
  t = 48400; w.tick();
  assert.equal(w.el.textContent, 'still writing… 48 s');
  delete msg.dataset.streaming; t = 175000; w.tick();
  assert.equal(w.el.textContent, 'Reply complete · 175 s in all');
  assert.equal(ticks, 1, 'the timer was cleared');
  t = 999000; w.tick();
  assert.equal(w.el.textContent, 'Reply complete · 175 s in all', 'a stopped status does not change again');
});
