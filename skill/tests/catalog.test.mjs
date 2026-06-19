// Integration tests for the storage-consolidation catalog (lib/catalog/*).
// Run: node --test skill/tests/catalog.test.mjs   (needs `npx tsc` first; uses system zip)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCardId, bundleIdFromName } from '../dist/lib/catalog/ids.js';
import { openCatalog } from '../dist/lib/catalog/db.js';
import { catalogSync, indexBundle } from '../dist/lib/catalog/sync.js';
import { replay, due } from '../dist/lib/catalog/sr.js';

function fresh() { return mkdtempSync(join(tmpdir(), 'chiron-catalog-test-')); }

// build a fake .chiron bundle (zip a dir) with chiron.json + one chapter w/ srCards
function makeBundle(dir, name, domain, cards) {
  const b = join(dir, name);
  mkdirSync(b, { recursive: true });
  writeFileSync(join(b, 'chiron.json'), JSON.stringify({ format: 'chiron-bundle/1', title: name + ' title', domain, entry: 'lesson.html' }));
  writeFileSync(join(b, 'lesson.html'), `<title>${name}</title><body>hi</body>`);
  writeFileSync(join(b, 'chapter1.json'), JSON.stringify({ chapterId: 'ch1', chapterNumber: 1, title: 'Ch1', srCards: cards }));
  const out = join(dir, name + '.chiron');
  execFileSync('zip', ['-r', '-q', '-X', out, '.'], { cwd: b });
  return out;
}

test('resolveCardId ladder: concept→T1, chapter→T2, hash→T3', () => {
  assert.deepEqual(resolveCardId('bun', { concept_id: 'hypogonadism' }, 2), { id: 'hypogonadism:2', tier: 1 });
  assert.deepEqual(resolveCardId('bun', { chapterId: 'ch3' }, 5), { id: 'bun:ch3:5', tier: 2 });
  const t3 = resolveCardId('bun', { front: 'What is X?' }, 0);
  assert.equal(t3.tier, 3);
  assert.match(t3.id, /^bun:[0-9a-f]{8}$/);
});

test('resolveCardId honors an explicit generator-emitted stable id (Tier 1)', () => {
  // generator emitted "<concept>:<nn>" → used verbatim, ignores the derived ordinal
  assert.deepEqual(resolveCardId('bun', { id: 'hypogonadism:3', concept_id: 'hypogonadism' }, 0),
    { id: 'hypogonadism:3', tier: 1 });
  // a bogus explicit id NOT matching the concept prefix is ignored → derived
  assert.deepEqual(resolveCardId('bun', { id: 'wrong', concept_id: 'hypogonadism' }, 1),
    { id: 'hypogonadism:1', tier: 1 });
});

test('Tier-1 derived ids are stable per-concept across chapter position', () => {
  const dir = fresh();
  const sources = join(dir, 'src'); mkdirSync(sources, { recursive: true });
  // two cards share concept "alpha" in different positions; one "beta"
  const bundle = makeBundle(sources, 'chiron-conc', 'medicine', [
    { front: 'a1?', back: 'x', concept_id: 'alpha' },
    { front: 'b1?', back: 'y', concept_id: 'beta' },
    { front: 'a2?', back: 'z', concept_id: 'alpha' },
  ]);
  const cat = openCatalog(join(dir, 'catalog.db'));
  const r = indexBundle(cat, bundle);
  assert.equal(r.tier, 1);
  const ids = cat.raw.prepare('SELECT id FROM cards ORDER BY id').all().map((x) => x.id);
  assert.deepEqual(ids, ['alpha:0', 'alpha:1', 'beta:0']); // per-concept ordinal, not chapter pos
  cat.raw.close();
});

test('bundleIdFromName strips chiron- prefix, date stamp, version', () => {
  assert.equal(bundleIdFromName('chiron-klinefelter-amboss.chiron'), 'klinefelter-amboss');
  assert.equal(bundleIdFromName('graphiti-implementation-2026-05-23-v1'), 'graphiti-implementation');
  assert.equal(bundleIdFromName('graphiti-implementation-2026-05-23'), 'graphiti-implementation');
});

test('indexBundle: medicine layout → chapters + cards + FTS, tier 2 (no concept_id)', () => {
  const dir = fresh();
  const bundle = makeBundle(dir, 'med-x', 'medicine', [
    { front: 'Q1?', back: 'A1', tags: ['endo'] },
    { front: 'Q2?', back: 'A2', tags: ['endo', 'genetics'] },
  ]);
  const cat = openCatalog(join(dir, 'catalog.db'));
  const r = indexBundle(cat, bundle);
  assert.equal(r.domain, 'medicine');
  assert.equal(r.cards, 2);
  assert.equal(r.tier, 2); // chapterId present, no concept_id
  const fts = cat.raw.prepare("SELECT count(*) c FROM cards_fts WHERE cards_fts MATCH 'Q1'").get();
  assert.equal(fts.c, 1);
  cat.raw.close();
});

test('catalogSync: consolidates + dedupes + writes registry', () => {
  const dir = fresh();
  const sources = join(dir, 'src'); mkdirSync(sources, { recursive: true });
  makeBundle(sources, 'chiron-alpha-2026-01-01', 'code', [{ front: 'a?', back: 'b' }]);
  makeBundle(sources, 'chiron-alpha-2026-01-01-v1', 'code', [{ front: 'a?', back: 'b' }]); // dup id "alpha"
  makeBundle(sources, 'chiron-beta', 'medicine', [{ front: 'c?', back: 'd', chapterId: 'ch1' }]);
  const out = join(dir, 'bundles');
  const { consolidated, indexed } = catalogSync({
    bundlesDir: out, catalogPath: join(dir, 'catalog.db'),
    bundleSources: [sources], looseRoots: [],
  });
  // alpha de-duped to ONE bundle id, beta separate → 2 bundles
  assert.equal(indexed.length, 2);
  assert.ok(consolidated.duplicates.some((d) => d.bundleId === 'alpha'));
});

test('replay is path-dependent + due is cross-lesson', () => {
  const dir = fresh();
  const sources = join(dir, 'src'); mkdirSync(sources, { recursive: true });
  makeBundle(sources, 'chiron-lessonA', 'medicine', [{ front: 'A1?', back: 'x', chapterId: 'ch1' }]);
  makeBundle(sources, 'chiron-lessonB', 'medicine', [{ front: 'B1?', back: 'y', chapterId: 'ch1' }]);
  const catalogPath = join(dir, 'catalog.db');
  catalogSync({ bundlesDir: join(dir, 'bundles'), catalogPath, bundleSources: [sources], looseRoots: [] });

  const cat = openCatalog(catalogPath);
  const ids = cat.raw.prepare('SELECT id,bundle_id FROM cards').all();
  const a = ids.find((r) => r.bundle_id === 'lessonA').id;
  const b = ids.find((r) => r.bundle_id === 'lessonB').id;
  const eventsDir = join(dir, 'events'); mkdirSync(eventsDir, { recursive: true });
  const now = Date.now();
  // A: again(1) then good(3) — reps must go 0→1 (path-dependent). B: good(3) once.
  writeFileSync(join(eventsDir, 'd.jsonl'), [
    JSON.stringify({ t: 'rev', cid: a, r: 1, ts: now - 2000 }),
    JSON.stringify({ t: 'rev', cid: a, r: 3, ts: now - 1000 }),
    JSON.stringify({ t: 'rev', cid: b, r: 3, ts: now - 1500 }),
    JSON.stringify({ t: 'rev', cid: 'ghost:card:0', r: 3, ts: now - 100 }), // unknown → tombstone
  ].join('\n') + '\n');

  const rr = replay(cat, eventsDir);
  assert.equal(rr.cards, 2);
  assert.equal(rr.tombstoned, 1);
  const aState = cat.raw.prepare('SELECT repetitions FROM sr_cards WHERE card_id=?').get(a);
  assert.equal(aState.repetitions, 1); // 0 after again, then 1 after good — folded in order

  const dueRows = due(cat, now + 10 * 86400000, 50); // +10d: everything due
  assert.equal(dueRows.length, 2);
  assert.equal(new Set(dueRows.map((r) => r.bundle_id)).size, 2); // CROSS-lesson
  cat.raw.close();
});
