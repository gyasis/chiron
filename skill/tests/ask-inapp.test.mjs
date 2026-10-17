// Chiedi (Ask) inside the phone app: in-app detection, link/window.open interception with an origin-checked
// postMessage bridge, and the overlay back-stack (Android back -> popstate closes the overlay).
// Run: node --test skill/tests/ask-inapp.test.mjs   (no build step; plain browser scripts under small fakes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isInApp, appOrigin, installInAppBridge } from '../ask/inapp.js';

const APP = 'http://tauri.localhost', LIB = 'http://192.168.0.146:8911';

/* ---------- tiny fakes ---------- */
function listeners() {
  const m = {};
  return { on: (t, f) => (m[t] ||= []).push(f), fire: (t, ev) => (m[t] || []).forEach(f => f(ev)) };
}
function askWindow({ search = '?inapp=1', ancestor = APP, framed = true } = {}) {
  const docL = listeners(), winL = listeners(), posted = [], attrs = {};
  const parent = { postMessage: (data, origin) => posted.push({ data, origin }) };
  const win = {
    location: { search, href: LIB + '/ask/' + search, origin: LIB, ancestorOrigins: ancestor ? [ancestor] : [] },
    document: { referrer: '', addEventListener: docL.on, documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    addEventListener: winL.on, open: () => 'native-window',
  };
  win.parent = framed ? parent : win;
  return { win, posted, attrs, docL, winL, parent };
}
function anchor(href, target = '') { return { getAttribute: () => href, target, closest: () => anchor.self }; }
function click(docL, a) {
  anchor.self = a; let prevented = false;
  docL.fire('click', { target: a, defaultPrevented: false, preventDefault: () => { prevented = true; } });
  return prevented;
}

/* ---------- Ask side ---------- */
test('in-app mode is ?inapp=1 only', () => {
  assert.equal(isInApp('?inapp=1'), true);
  assert.equal(isInApp('?theme=dark&inapp=1'), true);
  for (const s of ['', '?inapp=0', '?inapp=true', '?inapp=', '?inapp=11', '?xinapp=1']) assert.equal(isInApp(s), false, s);
});

test('appOrigin: only a known app embedder counts', () => {
  assert.equal(appOrigin(askWindow().win), APP);
  assert.equal(appOrigin(askWindow({ ancestor: 'tauri://localhost' }).win), 'tauri://localhost');
  assert.equal(appOrigin(askWindow({ ancestor: 'https://evil.example' }).win), null);
  assert.equal(appOrigin(askWindow({ framed: false }).win), null);
});

test('not in-app (plain web / hub): no bridge, window.open untouched', () => {
  for (const o of [{ search: '' }, { ancestor: 'https://evil.example' }, { framed: false }]) {
    const { win, docL } = askWindow(o);
    assert.equal(installInAppBridge(win), null);
    assert.equal(win.open('x'), 'native-window');
    assert.equal(click(docL, anchor('/library/', '_blank')), false);
  }
});

test('in-app: window.open and leaving links are posted to the app origin, not opened', () => {
  const { win, posted, docL } = askWindow();
  const open = installInAppBridge(win);
  assert.equal(typeof open, 'function');
  assert.deepEqual(posted.shift(), { data: { type: 'chiron-ask:ready' }, origin: APP });
  assert.equal(win.open('/lessons/chiron-x/lesson.html#s2', '_blank'), null);
  assert.deepEqual(posted.shift(), { data: { type: 'chiron-ask:open', url: LIB + '/lessons/chiron-x/lesson.html#s2' }, origin: APP });
  assert.equal(click(docL, anchor('/library/', '_blank')), true);            // "Watch it in the library"
  assert.equal(posted.shift().data.url, LIB + '/library/');
  assert.equal(click(docL, anchor('/lessons/chiron-x/lesson.html#t=42')), true);   // clip's "open the lesson"
  assert.equal(posted.shift().data.url, LIB + '/lessons/chiron-x/lesson.html#t=42');
  assert.equal(click(docL, anchor('/ask/?q=hi')), false);                  // stays inside Ask
  assert.equal(click(docL, anchor('#top')), false);                        // in-page anchor
  assert.equal(posted.length, 0);
});

test('in-app: theme is accepted only from the parent at the app origin', () => {
  const { win, winL, attrs, parent } = askWindow();
  installInAppBridge(win);
  winL.fire('message', { origin: 'https://evil.example', source: parent, data: { type: 'chiron-app:theme', theme: 'dark' } });
  winL.fire('message', { origin: APP, source: {}, data: { type: 'chiron-app:theme', theme: 'dark' } });
  winL.fire('message', { origin: APP, source: parent, data: { type: 'chiron-app:theme', theme: 'neon' } });
  assert.equal(attrs['data-theme'], undefined);
  winL.fire('message', { origin: APP, source: parent, data: { type: 'chiron-app:theme', theme: 'dark' } });
  assert.equal(attrs['data-theme'], 'dark');
});

test('in-app: theme goes through onTheme when given (Ask re-paints acolyte\'s tokens there)', () => {
  const { win, winL, parent } = askWindow(), got = [];
  installInAppBridge(win, { onTheme: t => got.push(t) });
  winL.fire('message', { origin: 'https://evil.example', source: parent, data: { type: 'chiron-app:theme', theme: 'light' } });
  winL.fire('message', { origin: APP, source: parent, data: { type: 'chiron-app:theme', theme: 'light' } });
  assert.deepEqual(got, ['light']);
});

/* ---------- app side (chiron-tauri/mobile/nav.js, a classic script) ---------- */
function appWindow() {
  const winL = listeners(), els = {};
  const el = id => (els[id] ||= { id, cls: new Set(), classList: { add: c => els[id].cls.add(c), remove: c => els[id].cls.delete(c), contains: c => els[id].cls.has(c) } });
  const entries = [null]; let at = 0;
  const history = {
    get state() { return entries[at]; }, get length() { return entries.length; },
    pushState(s) { entries.splice(at + 1); entries.push(s); at++; },
    back() { if (at > 0) { at--; winL.fire('popstate', { state: entries[at] }); } },   // what WebView.goBack() does
    canGoBack: () => at > 0,
  };
  const win = { addEventListener: winL.on, history };
  const ctx = { window: win, URL, console };   // the browser globals nav.js uses
  runInNewContext(readFileSync(new URL('../chiron-tauri/mobile/nav.js', import.meta.url), 'utf8'), ctx);
  return { win, winL, history, doc: { getElementById: el }, el, Nav: win.ChironNav };
}

test('overlay: open pushes a history entry, hardware back closes it, then back leaves the app as before', () => {
  const { win, doc, el, history, Nav } = appWindow();
  const nav = Nav.overlayStack(win, doc);
  nav.open('askov');
  assert.equal(el('askov').classList.contains('open'), true);
  assert.equal(history.canGoBack(), true);
  history.back();                                   // Android back
  assert.equal(el('askov').classList.contains('open'), false);
  assert.equal(history.canGoBack(), false);          // next back finishes the activity, as before
});

test('overlay: ‹ button consumes the entry; stacked overlays close top-first; re-open of the top adds no entry', () => {
  const { win, doc, el, history, Nav } = appWindow();
  const nav = Nav.overlayStack(win, doc);
  nav.open('askov'); nav.open('lesson'); nav.open('lesson');
  assert.equal(history.length, 3);
  history.back();
  assert.equal(el('lesson').classList.contains('open'), false);
  assert.equal(el('askov').classList.contains('open'), true);
  nav.close('askov');                               // the ‹ button
  assert.equal(el('askov').classList.contains('open'), false);
  assert.equal(history.canGoBack(), false);
});

function bridge() {
  const a = appWindow(), opened = [];
  // JSON round-trip: objects built inside the vm context carry its prototypes (deepStrictEqual would differ on realm)
  const askWin = { postMessage: (data, origin) => opened.push(['post', JSON.parse(JSON.stringify(data)), origin]) };
  const frame = { contentWindow: askWin, dataset: { src: LIB + '/ask/?inapp=1' } };
  const api = a.Nav.askBridge(a.win, { frame: () => frame, origin: () => LIB, currentTheme: () => 'dark',
    openLesson: (id, hash) => opened.push(['lesson', id, hash]), openExternal: url => opened.push(['ext', url]) });
  const send = (data, o = {}) => a.winL.fire('message', { source: askWin, origin: LIB, data, ...o });
  return { api, send, opened, askWin };
}

test('app bridge: lessons go to the lesson overlay, anything else to the system browser', () => {
  const { send, opened } = bridge();
  send({ type: 'chiron-ask:open', url: LIB + '/lessons/chiron-acute-pericarditis-amboss/lesson.html#t=42' });
  send({ type: 'chiron-ask:open', url: LIB + '/library/' });
  send({ type: 'chiron-ask:open', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' });
  assert.deepEqual(opened, [['lesson', 'chiron-acute-pericarditis-amboss', '#t=42'], ['ext', LIB + '/library/'], ['ext', 'https://pubmed.ncbi.nlm.nih.gov/1/']]);
});

test('app bridge: origin + source checked; non-http schemes refused', () => {
  const { send, opened } = bridge();
  const msg = { type: 'chiron-ask:open', url: LIB + '/library/' };
  send(msg, { origin: 'https://evil.example' });
  send(msg, { source: {} });
  send({ type: 'chiron-ask:open', url: 'javascript:alert(1)' });
  send({ type: 'chiron-ask:open', url: 'intent://x#Intent;end' });
  assert.deepEqual(opened, []);
});

test('app bridge: theme is posted to the Ask frame at its origin, also on ready', () => {
  const { api, send, opened } = bridge();
  api.theme('light');
  send({ type: 'chiron-ask:ready' });
  assert.deepEqual(opened, [['post', { type: 'chiron-app:theme', theme: 'light' }, LIB], ['post', { type: 'chiron-app:theme', theme: 'dark' }, LIB]]);
});
