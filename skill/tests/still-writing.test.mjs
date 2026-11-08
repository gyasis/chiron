// still-writing — the page-owned status line that keeps counting while a phrase reply streams.
// Run: node --test skill/tests/still-writing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Node, doc } from './fake-dom.mjs';
import { stillWriting, cutShort } from '../ask/still-writing.js';

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

test('a failed reply: a later assistant message stops the count and says the reply was cut short', () => {
  const list = new Node('div'); const msg = mk(); list.appendChild(msg); let t = 5000;
  const w = stillWriting(doc, msg, 0, { now: () => t, setTimer: () => 7, clearTimer: () => {} });
  assert.equal(cutShort(msg), false);
  const err = new Node('div'); err.className = 'acolyte-msg assistant'; list.appendChild(err);   // acolyte's "⚠ Answer interrupted" bubble
  t = 90000; w.tick();
  assert.equal(w.el.textContent, 'Reply cut short · 90 s');
  assert.equal(msg.dataset.streaming, '', 'the half-written reply is no longer marked as streaming');
  assert.equal(msg.dataset.cut, '1');
  t = 2772000; w.tick();
  assert.equal(w.el.textContent, 'Reply cut short · 90 s', 'it does not keep counting');
});

test('a user message after the reply is not a cut', () => {
  const list = new Node('div'); const msg = mk(); list.appendChild(msg);
  const u = new Node('div'); u.className = 'acolyte-msg user'; list.appendChild(u);
  assert.equal(cutShort(msg), false);
});
