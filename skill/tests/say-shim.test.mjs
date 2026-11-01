// say-shim: a fetch that rejects after cancel() must not replay the utterance queued after the cancel.
// Run: node --test skill/tests/say-shim.test.mjs   (the plain browser script runs under small fakes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC = readFileSync(new URL('../ask/say-shim.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
const OK = { ok: true, blob: () => Promise.resolve({}) };

function shim() {
  const fetches = [], audios = [], warns = [];
  const window = {};
  const ctx = {
    window, location: { search: '?inapp=1' }, navigator: { userAgent: '' },
    console: { warn: (...a) => warns.push(a.join(' ')), log() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    fetch: (url, opts) => new Promise((resolve, reject) => fetches.push({ body: JSON.parse(opts.body), resolve, reject })),
    Audio: function () { audios.push(this); this.play = () => Promise.resolve(); this.pause = () => {}; },
  };
  runInNewContext(SRC, ctx);
  return { synth: window.speechSynthesis, U: window.SpeechSynthesisUtterance, fetches, audios, warns };
}
const utter = (U, text) => {
  const u = new U(text); u.events = [];
  u.onstart = () => u.events.push('start'); u.onend = () => u.events.push('end'); u.onerror = () => u.events.push('error');
  return u;
};

test('a rejected fetch of a cancelled utterance does not replay the next one', async () => {
  const { synth, U, fetches, audios, warns } = shim();
  const a = utter(U, 'Hello there.'), b = utter(U, 'Second one.');
  synth.speak(a);
  assert.equal(fetches.length, 1);
  synth.cancel();                                 // A's fetch is still in flight
  synth.speak(b);                                 // B starts its own fetch
  assert.equal(fetches.length, 2);
  fetches[0].reject(new Error('TTS HTTP 500'));   // A's fetch fails late
  await tick();
  assert.equal(synth.speaking, true, 'B is still current');
  assert.equal(a.events.length, 0, 'the cancelled utterance fires nothing');
  assert.ok(warns.some(w => /cancelled utterance failed/.test(w)), 'the ignored failure is logged');
  fetches[1].resolve(OK);                       // B's audio arrives
  await tick();
  assert.equal(audios.length, 1, 'B plays exactly once');
  audios[0].onended();
  await tick();
  assert.deepEqual(b.events, ['start', 'end']);
  assert.equal(synth.speaking, false);
});

test('a failed fetch of the current utterance still fires error and moves on', async () => {
  const { synth, U, fetches } = shim();
  const a = utter(U, 'Only one.');
  synth.speak(a);
  fetches[0].reject(new Error('TTS HTTP 500'));
  await tick();
  assert.deepEqual(a.events, ['error']);
  assert.equal(synth.speaking, false);
});

test('an utterance with an Italian lang hint is voiced in Italian even without Italian stop-words', () => {
  const { synth, U, fetches } = shim();
  const withHint = utter(U, 'Ho mal testa.'); withHint.lang = 'it-IT';
  const noHint = utter(U, 'Ho mal testa.');
  synth.speak(withHint);
  synth.cancel();
  synth.speak(noHint);
  assert.equal(fetches[0].body.lang, 'it', 'phrase mode sets it-IT on every utterance');
  assert.equal(fetches[1].body.lang, 'en', 'without a hint the stop-word guess defaults to English');
});
