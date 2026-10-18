// Play tab playlist building, against REAL manifests when ~/Documents/generated has them plus a fixed fixture.
// Run: node --test skill/tests/play-playlist.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
const { parseManifest, buildPlaylist } = createRequire(import.meta.url)('../chiron-tauri/mobile/play.js');

const BASE = 'http://lib:8911/lessons/a/b c/lesson.html?inapp=1';
const clip = (artifact, audioPath, o = {}) => ({ artifact, sectionId: '', audioPath, status: 'done', durationS: 5, ...o });

test('parseManifest reads the manifest.js literal without eval', () => {
  const m = parseManifest('window.__chironAudioManifest = {"clips": [{"artifact":"summary","audioPath":"audio/summary.mp3","status":"done"}]};\n');
  assert.equal(m.clips.length, 1);
  assert.throws(() => parseManifest('window.__chironAudioManifest = alert(1);'));
  assert.throws(() => parseManifest('{"nope":1}'));
});

test('order: riepilogo, sections in manifest order, drill pimsleur, lezione completa', () => {
  const m = { clips: [
    clip('pimsleur', 'audio/pimsleur.mp3', { label: 'Pimsleur · X' }), clip('shortened', 'audio/shortened.mp3'),
    clip('dialogue', 'audio/dialogue/dlg-a.mp3', { sectionId: 'dlg-a' }), clip('summary', 'audio/summary.mp3'),
    clip('phrase', 'audio/phrase/vocab-b.mp3', { sectionId: 'vocab-b' }),
  ] };
  const p = buildPlaylist(m, BASE);
  assert.deepEqual(p.map(x => x.kind), ['summary', 'dialogue', 'phrase', 'pimsleur', 'shortened']);
  assert.deepEqual(p.map(x => x.group), ['Introduzione', 'Sezioni', 'Sezioni', 'Drill Pimsleur', 'Lezione completa']);
  assert.equal(p[0].title, 'Riepilogo');
  assert.equal(p[1].title, 'Dialogo · A');
  assert.equal(p[3].title, 'Pimsleur · X');
  assert.equal(p[4].title, 'Lezione completa');
});

test('missing / unfinished / duplicate / unknown clips are skipped; urls resolve against the lesson dir', () => {
  const m = { clips: [clip('summary', 'audio/summary.mp3', { status: 'pending' }), clip('phrase', 'audio/p/x y.mp3', { sectionId: 'vocab-x' }),
    clip('phrase', 'audio/p/x y.mp3', { sectionId: 'vocab-x' }), clip('mystery', 'audio/m.mp3'), { artifact: 'dialogue', status: 'done' }] };
  const p = buildPlaylist(m, BASE);
  assert.equal(p.length, 1);
  assert.equal(p[0].url, 'http://lib:8911/lessons/a/b c/audio/p/x%20y.mp3');
  assert.deepEqual(buildPlaylist({ clips: [] }, BASE), []);
});

const REAL = homedir() + '/Documents/generated/chiron-medicina-italiana/situazioni/ordine-colleghi-ssn-ecm/audio/manifest.js';
test('real manifest (ordine-colleghi-ssn-ecm)', { skip: !existsSync(REAL) }, () => {
  const m = parseManifest(readFileSync(REAL, 'utf8'));
  const done = m.clips.filter(c => c.status === 'done' && c.audioPath);
  const p = buildPlaylist(m, BASE);
  assert.equal(p.length, done.length);
  assert.equal(p[0].kind, 'summary'); assert.equal(p.at(-1).kind, 'shortened'); assert.equal(p.at(-2).kind, 'pimsleur');
  assert.ok(p.every(x => x.url.startsWith('http://lib:8911/lessons/a/b c/audio/')));
  assert.ok(p.every(x => x.title && x.group));
});
