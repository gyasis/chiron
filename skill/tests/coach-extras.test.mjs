// coach-extras: the fenced-block parser, the diagram renderer's escaping and toggles, "Study more", the Pimsleur confirm and
// the basket. A tiny fake DOM stands in for the browser; its innerHTML setter THROWS, so any code path that puts text
// through innerHTML fails the test.
// Run: node --test skill/tests/coach-extras.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFenceBlock, safeHref, buildDiagram, buildRelated, describeGenerate, describePimsleur, deriveTopic,
  buildPimsleurAction, createBasket, buildAddRow,
} from '../ask/coach-extras.js';

import { Node, doc, tick } from './fake-dom.mjs';
const XSS = '<img src=x onerror=alert(1)>';

const DOC = {
  type: 'annotated-passage', id: 'ap', language: 'it', genre: 'dialogue-script',
  layers: [{ key: 'verbs', label: 'Verbs', defaultOn: true }, { key: 'literal', label: 'Word for word', defaultOn: false }],
  sentences: [{ idx: 1, text: 'Devo fare.', translation: 'I have to do.', literal: 'I-must do', registerNote: 'neutral',
    tokens: [{ surface: 'Devo', lemma: 'dovere', pos: 'VERB', layer: 'verbs', features: { person: 1 }, note: XSS },
             { surface: 'fare', lemma: 'fare', pos: 'VERB', layer: 'verbs', note: 'to do' }],
    phrases: [{ surface: 'fare', type: 'verb-phrase', meaning: XSS, note: XSS }], tips: [XSS] }],
};

test('parseFenceBlock: diagram and related blocks', () => {
  const raw = 'text\n```diagram\n' + JSON.stringify(DOC) + '\n```\n\n```related\n{"lessons":[],"missing":["x"]}\n```';
  assert.equal(parseFenceBlock(raw, 'diagram').ok, true);
  assert.deepEqual(parseFenceBlock(raw, 'related').data.missing, ['x']);
  assert.equal(parseFenceBlock('nothing', 'diagram').ok, false);
  assert.match(parseFenceBlock('```diagram\n{bad\n```', 'diagram').reason, /not valid JSON/);
  assert.equal(parseFenceBlock('```diagram\n{"sentences":[]}\n```', 'diagram').ok, false);
  assert.equal(parseFenceBlock('```diagram\n[1]\n```', 'diagram').ok, false);
});

test('diagram: model text is rendered as text, never as markup', () => {
  const root = buildDiagram(doc, DOC);                    // the fake innerHTML setter throws if it is ever used
  const tok = root.byClass('dg-tok')[0];
  tok.fire('focus');
  const note = root.byClass('dg-note')[0];
  assert.ok(note.textContent.includes(XSS), 'the note holds the literal characters');
  assert.equal(root.all(n => n.tagName === 'IMG').length, 0, 'no <img> element was created');
  assert.ok(root.textContent.includes(XSS));
  assert.ok(root.byClass('dg-phrase')[0].textContent.includes(XSS));
  assert.ok(root.byClass('dg-tips')[0].textContent.includes(XSS));
});

test('diagram: layer toggles hide and show, and defaultOn:false starts hidden', () => {
  const root = buildDiagram(doc, DOC);
  assert.equal(root.classList.contains('dg-hide-literal'), true);
  assert.equal(root.classList.contains('dg-hide-verbs'), false);
  const [verbs, literal] = root.byClass('dg-layer');
  assert.equal(verbs.getAttribute('aria-pressed'), 'true');
  assert.equal(literal.getAttribute('aria-pressed'), 'false');
  verbs.click();
  assert.equal(root.classList.contains('dg-hide-verbs'), true);
  assert.equal(verbs.getAttribute('aria-pressed'), 'false');
  literal.click();
  assert.equal(root.classList.contains('dg-hide-literal'), false);
  assert.equal(verbs.tagName, 'BUTTON');                  // native buttons: keyboard and touch work
});

test('safeHref keeps same-site paths only', () => {
  assert.equal(safeHref('/lessons/x/lesson.html#a'), '/lessons/x/lesson.html#a');
  for (const bad of ['javascript:alert(1)', '//evil.example/x', 'https://evil.example', '', null, 5, '/a b']) assert.equal(safeHref(bad), null, String(bad));
});

test('describeGenerate: a duplicate says "already exists" with a link, never "Queued"', () => {
  const dup = describeGenerate({ duplicate: true, status: 'ready', slug: 'chiron-italian-x', lesson_url: '/lessons/chiron-italian-x/lesson.html' });
  assert.match(dup.text, /already exists/i);
  assert.doesNotMatch(dup.text, /Queued/);
  assert.equal(dup.href, '/lessons/chiron-italian-x/lesson.html');
  const inflight = describeGenerate({ duplicate: true, status: 'running' });
  assert.match(inflight.text, /Already exists/);
  assert.doesNotMatch(inflight.text, /Queued/);
  assert.match(describeGenerate({ slug: 'a', status: 'queued' }).text, /^Queued/);
});

test('related: lessons are links, unsafe urls are not, missing topics get a Make-a-lesson button', async () => {
  const calls = [];
  const gen = async topic => { calls.push(topic); return { duplicate: true, status: 'ready', slug: 's', lesson_url: '/lessons/s/lesson.html' }; };
  const root = buildRelated(doc, {
    lessons: [{ title: XSS, url: '/lessons/a/lesson.html#c', topic: 'dovere + infinito', section: 'Cap 1' },
              { title: 'Bad', url: 'javascript:alert(1)', topic: 't' }],
    missing: ['si impersonale'],
  }, gen);
  const links = root.byClass('rel-link');
  assert.equal(links[0].tagName, 'A');
  assert.equal(links[0].href, '/lessons/a/lesson.html#c');
  assert.ok(links[0].textContent.includes(XSS));
  assert.equal(links[1].tagName, 'SPAN');                 // unsafe url: shown, not linked
  const btn = root.byClass('rel-make')[0];
  assert.equal(btn.textContent, 'Make a lesson on si impersonale');
  await btn.click();
  await tick();
  assert.deepEqual(calls, ['si impersonale']);
  const st = root.byClass('act-status')[0];
  assert.match(st.textContent, /already exists/i);
  assert.doesNotMatch(st.textContent, /Queued/);
  assert.equal(st.byClass ? st.all(n => n.tagName === 'A')[0].href : '', '/lessons/s/lesson.html');
});

test('related: a failed queue request re-enables the button and says why', async () => {
  const root = buildRelated(doc, { lessons: [], missing: ['x'] }, async () => { throw new Error('boom'); });
  const btn = root.byClass('rel-make')[0];
  await btn.click();
  await tick();
  assert.equal(btn.disabled, false);
  assert.match(root.byClass('act-status')[0].textContent, /Could not queue: boom/);
});

const PH = [{ it: 'Dov\'è l\'ambulatorio?', en: 'Where is the clinic?', register: 'neutral' },
            { it: 'Chi è il mio tutor?', en: 'Who is my tutor?', register: '' },
            { it: XSS, en: XSS, register: 'lei' }];

test('pimsleur action: the confirm lists phrases as text; a duplicate says it exists', async () => {
  const sent = [];
  const row = buildPimsleurAction(doc, PH, async body => { sent.push(body); return { duplicate: true, url: '/library/', topic: 't' }; });
  const open = row.byClass('px-open')[0];
  assert.match(open.textContent, /from these 3 phrases/);
  await open.click();
  const box = row.byClass('px-confirm')[0];
  assert.ok(box.textContent.includes(XSS));
  assert.equal(row.all(n => n.tagName === 'IMG').length, 0);
  assert.match(box.textContent, /Mac Studio/);
  assert.equal(row.byClass('px-topic')[0].value, deriveTopic(PH));
  await row.byClass('px-go')[0].click();
  await tick();
  assert.equal(sent[0].confirm, true);
  assert.equal(sent[0].phrases.length, 3);
  assert.match(row.byClass('act-status')[0].textContent, /already exists/);
  assert.doesNotMatch(row.byClass('act-status')[0].textContent, /Queued/);
  assert.match(buildPimsleurAction(doc, [PH[0]], async () => ({})).byClass('px-open')[0].textContent, /from this phrase/);
});

test('describePimsleur: queued vs duplicate, with the Mac warning', () => {
  assert.match(describePimsleur({ topic: 'T', url: '/library/', warning: 'Mac Studio is away' }).text, /Queued a Pimsleur season on "T"\. Mac Studio is away/);
  const d = describePimsleur({ duplicate: true, url: '/library/' });
  assert.equal(d.duplicate, true);
  assert.match(d.text, /already exists/);
});

function fakeServer(items = []) {
  const log = [];
  const state = { items: items.slice(), post: null };
  const api = async (method, path, body) => {
    log.push([method, path, body]);
    if (method === 'GET') return { items: state.items.map(i => ({ it: i.it, en: i.en, note: i.register ? 'register:' + i.register : '' })) };
    if (method === 'POST' && path.endsWith('/items')) { for (const i of body.items) state.items.push({ it: i.it, en: i.en, register: (/register:(\w+)/.exec(i.note) || [])[1] || '' }); return {}; }
    if (method === 'DELETE') { const it = decodeURIComponent(path.split('it=')[1]); state.items = state.items.filter(i => i.it !== it); return {}; }
    if (path === '/api/pimsleur/topic') { state.topicCalls = (state.topicCalls || 0) + 1; return { topic: state.topic || 'Primo giorno di specializzazione' }; }
    if (path === '/api/pimsleur/from-phrases') { const r = state.post; if (r && !r.duplicate) state.items = []; return r; }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  return { api, state, log };
}
const mkBasket = srv => {
  const pill = new Node('button'), panel = new Node('div');
  return { pill, panel, basket: createBasket({ doc, api: srv.api, pill, panel }) };
};

test('basket: count on the pill, ➕ / ✓ toggle, and phrase text is escaped in the list', async () => {
  const srv = fakeServer();
  const { pill, panel, basket } = mkBasket(srv);
  assert.equal(pill.textContent, '🎧 Basket 0/8');
  const row = buildAddRow(doc, basket, PH);
  const [all] = row.byClass('bk-all');
  assert.equal(all.textContent, '➕ Add all 3');
  const plus = row.byClass('bk-plus');
  assert.deepEqual(plus.map(b => b.textContent), ['➕', '➕', '➕']);
  await plus[0].click();
  await tick();
  assert.equal(pill.textContent, '🎧 Basket 1/8');
  assert.equal(plus[0].textContent, '✓');
  await plus[0].click();                                   // ✓ removes
  await tick();
  assert.equal(pill.textContent, '🎧 Basket 0/8');
  assert.equal(plus[0].textContent, '➕');
  await all.click();
  await tick();
  assert.equal(pill.textContent, '🎧 Basket 3/8');
  assert.deepEqual(plus.map(b => b.textContent), ['✓', '✓', '✓']);
  assert.equal(all.disabled, true);
  basket.setOpen(true);
  assert.equal(panel.hidden, false);
  assert.ok(panel.textContent.includes(XSS));
  assert.equal(panel.all(n => n.tagName === 'IMG').length, 0);
  assert.equal(panel.byClass('bk-count')[0].textContent, '3 of 8');
  assert.equal(panel.byClass('bk-fill')[0].style.width, '38%');
  assert.equal(panel.byClass('bk-gen')[0].disabled, false);
});

test('basket: generating needs 3 phrases, asks to confirm, empties on success and keeps the items on a duplicate', async () => {
  const srv = fakeServer([PH[0], PH[1]]);
  const { panel, basket } = mkBasket(srv);
  await basket.refresh();
  basket.setOpen(true);
  assert.equal(panel.byClass('bk-gen')[0].disabled, true);
  await basket.add([PH[2]]);
  const gen = panel.byClass('bk-gen')[0];
  assert.equal(gen.disabled, false);
  await gen.click();
  assert.match(panel.byClass('bk-confirm')[0].textContent, /Mac Studio/);
  srv.state.post = { ok: true, duplicate: true, url: '/library/', topic: 't' };
  await panel.byClass('px-go')[0].click();
  await tick();
  assert.equal(basket.items.length, 3, 'a duplicate does not empty the basket');
  assert.match(panel.byClass('bk-msg')[0].textContent, /already exists/);
  assert.doesNotMatch(panel.byClass('bk-msg')[0].textContent, /Queued/);
  await panel.byClass('bk-gen')[0].click();
  srv.state.post = { ok: true, duplicate: false, topic: 'Il primo giorno', url: '/library/' };
  await panel.byClass('px-go')[0].click();
  await tick();
  assert.equal(basket.items.length, 0, 'a new run empties the basket');
  assert.match(panel.byClass('bk-msg')[0].textContent, /Queued a Pimsleur season on "Il primo giorno"/);
  const post = srv.log.filter(l => l[1] === '/api/pimsleur/from-phrases')[1][2];
  assert.deepEqual([post.collection, post.confirm], ['pimsleur-basket', true]);
});

test('basket: clearing asks first, then removes every item', async () => {
  const srv = fakeServer(PH);
  const { panel, basket } = mkBasket(srv);
  await basket.refresh();
  basket.setOpen(true);
  await panel.byClass('bk-clear')[0].click();
  assert.match(panel.byClass('bk-confirm')[0].textContent, /Remove all 3 phrases/);
  assert.equal(basket.items.length, 3, 'nothing is removed before the confirm');
  await panel.byClass('px-go')[0].click();
  await tick();
  assert.equal(basket.items.length, 0);
});

test('basket: a refresh picks up phrases added elsewhere (phone), and a failed save says so', async () => {
  const srv = fakeServer();
  const { pill, basket } = mkBasket(srv);
  srv.state.items.push(PH[0]);                             // added from another device
  await basket.refresh();
  assert.equal(pill.textContent, '🎧 Basket 1/8');
  const row = buildAddRow(doc, { ...basket, has: () => false, subscribe: () => {}, toggle: async () => { throw new Error('offline'); }, add: async () => { throw new Error('offline'); } }, [PH[1]]);
  await row.byClass('bk-plus')[0].click();
  await tick();
  assert.equal(row.dataset.error, 'offline');
});

test('basket: a refresh that changes nothing does not rebuild the pill or the panel (it would swallow a click in flight)', async () => {
  const srv = fakeServer(PH);
  const { pill, panel, basket } = mkBasket(srv);
  await basket.refresh();
  basket.setOpen(true);
  await tick();                                            // the topic suggestion lands and renders once
  const writes = pill.writes, first = panel.children[0];
  await basket.refresh();
  await basket.refresh();
  assert.equal(pill.writes, writes, 'the pill text node is left alone');
  assert.equal(panel.children[0], first, 'the panel DOM is left alone');
  srv.state.items.push({ it: 'Nuova frase.', en: 'New', register: '' });      // a real change does re-render
  await basket.refresh();
  assert.notEqual(panel.children[0], first);
  assert.match(pill.textContent, /4\/8/);
});

test('basket: the topic is suggested when the panel opens, unless the learner has typed one', async () => {
  const srv = fakeServer(PH);
  const { panel, basket } = mkBasket(srv);
  await basket.refresh();
  assert.equal(srv.state.topicCalls || 0, 0, 'closed panel: no suggestion call');
  basket.setOpen(true);
  await tick();
  assert.equal(panel.byClass('bk-topic')[0].value, 'Primo giorno di specializzazione');
  basket.setOpen(false); basket.setOpen(true);
  await tick();
  assert.equal(srv.state.topicCalls, 1, 'same basket content: asked once');
  const input = panel.byClass('bk-topic')[0];
  input.value = 'Il mio titolo';
  await input.fire('input');
  srv.state.items.push({ it: 'Nuova frase.', en: 'New', register: '' });
  await basket.refresh();
  await tick();
  assert.equal(panel.byClass('bk-topic')[0].value, 'Il mio titolo', 'a typed topic is never overwritten');
});
