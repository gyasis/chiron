// The phone's segmented reply: which block lands in which segment, and when a reply gets no control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doc } from './fake-dom.mjs';
import { segmentReply, sectionOf } from '../ask/segments.js';

const node = (tag, cls = '', text) => { const n = doc.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
const heading = (label, rest = '') => {
  const p = node('p'); p.appendChild(node('strong', '', label));
  if (rest) p.appendChild(doc.createTextNode(rest));
  return p;
};
function reply(blocks, extras = [], after = []) {
  const msg = node('div', 'acolyte-msg assistant');
  const body = msg.appendChild(node('div', 'acolyte-msg-body'));
  for (const b of blocks) body.appendChild(b);
  if (extras.length) { const box = msg.appendChild(node('div', 'ask-coach-extras')); for (const e of extras) box.appendChild(e); }
  for (const a of after) msg.appendChild(a);
  return { msg, body };
}
const coachReply = () => {
  const pre = node('pre', '', '{"it":"x"}'); pre.hidden = true;
  return reply([
    heading("Voglio imparare l'italiano."), heading("How it's built"), node('ol', '', '1. voglio'),
    heading('The pattern', ' Voglio [INF]'), heading('Watch out', ' wrong / right'), heading('Your turn', ' Try it'), pre,
  ], [node('div', 'bk-add'), node('section', 'ask-dg'), node('section', 'ask-rel'), node('div', 'px-action')],
     [node('div', 'ask-acts')]);
};

test('sectionOf: How it\'s built and Your turn are practice; every other heading stays on the answer', () => {
  assert.equal(sectionOf("How it's built · 2) Vorrei…"), 'use');
  assert.equal(sectionOf('Your turn'), 'use');
  assert.equal(sectionOf('Watch out'), 'answer');
  assert.equal(sectionOf('The pattern'), 'answer');
  assert.equal(sectionOf('Corrections'), 'answer');
});

test('a coach reply: traps stay on Answer, steps + Your turn + extras on Use it, Study more on Context', () => {
  const { msg, body } = coachReply();
  assert.deepEqual(segmentReply(doc, msg), ['answer', 'use', 'context']);
  const seg = body.children.map(c => c.dataset.seg);
  assert.deepEqual(seg, ['answer', 'use', 'use', 'answer', 'answer', 'use', undefined]);   // the hidden block is not tagged
  const ex = msg.byClass('ask-coach-extras')[0].children.map(c => c.dataset.seg);
  assert.deepEqual(ex, ['use', 'use', 'context', 'use']);
  assert.equal(msg.byClass('ask-acts')[0].dataset.seg, undefined, 'the action row is in every segment');
  const bar = msg.children[0];
  assert.equal(bar.className, 'ask-seg');
  assert.deepEqual(bar.children.map(b => b.textContent), ['Answer', 'Use it', 'Context']);
  assert.equal(msg.dataset.segOn, 'answer');
  bar.children[1].click();
  assert.equal(msg.dataset.segOn, 'use');
  assert.equal(bar.children[1].getAttribute('aria-selected'), 'true');
  assert.equal(bar.children[0].getAttribute('aria-selected'), 'false');
});

test('segmenting again keeps the chosen segment and one control', () => {
  const { msg } = coachReply();
  segmentReply(doc, msg);
  msg.children[0].children[2].click();
  segmentReply(doc, msg);
  assert.equal(msg.byClass('ask-seg').length, 1);
  assert.equal(msg.dataset.segOn, 'context');
});

test('a reply with no structured blocks gets no tabs and no tags', () => {
  const { msg, body } = reply([node('p', '', 'Here are five, in rising difficulty.'), node('ol', '', '1. …')], [], [node('div', 'ask-acts')]);
  assert.deepEqual(segmentReply(doc, msg), []);
  assert.equal(msg.byClass('ask-seg').length, 0);
  assert.equal(msg.dataset.segOn, undefined);
  assert.ok(body.children.every(c => c.dataset.seg === undefined));
});

test('a librarian reply with sources: Answer and Context', () => {
  const { msg } = reply([node('p', '', 'Dispnea is…')], [], [node('div', 'acolyte-sources'), node('div', 'ask-acts')]);
  assert.deepEqual(segmentReply(doc, msg), ['answer', 'context']);
  assert.equal(msg.byClass('acolyte-sources')[0].dataset.seg, 'context');
});

test('a recovered answer is walked inside its .ask-md wrapper and its note stays visible', () => {
  const md = node('div', 'ask-md');
  md.appendChild(heading('Ciao.')); md.appendChild(heading("How it's built")); md.appendChild(node('ol', '', '1.'));
  const note = node('div', 'ask-recovered-note', 'Recovered after the connection dropped.');
  const { msg } = reply([md, note]);
  assert.deepEqual(segmentReply(doc, msg), ['answer', 'use']);
  assert.deepEqual(md.children.map(c => c.dataset.seg), ['answer', 'use', 'use']);
  assert.equal(note.dataset.seg, undefined);
});
