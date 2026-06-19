// Tests for the Tier-1 (hydrate) + Tier-2 (similar) assessment primitives.
// Run: node --test skill/tests/assessment.test.mjs   (needs `npx tsc`; uses system zip)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydrateMcq, hydrateOrder, seedFrom } from '../dist/lib/catalog/hydrate.js';
import { openCatalog } from '../dist/lib/catalog/db.js';
import { catalogSync } from '../dist/lib/catalog/sync.js';
import { byConcept, similar } from '../dist/lib/catalog/similar.js';

// ---------- Tier 1: hydrate ----------

const Q = { stem: 'Best initial test?', options: ['A-karyotype', 'B-fsh', 'C-usg', 'D-mri'], answerIndex: 0 };

test('hydrateMcq: options permuted but the SAME answer text stays correct', () => {
  const h = hydrateMcq('card1', Q, 3);
  assert.equal(h.options.length, 4);
  assert.deepEqual([...h.options].sort(), [...Q.options].sort()); // same set
  assert.equal(h.options[h.answerIndex], Q.options[Q.answerIndex]); // answer preserved
});

test('hydrateMcq: deterministic per (card, exposure); varies across exposures', () => {
  assert.deepEqual(hydrateMcq('card1', Q, 3), hydrateMcq('card1', Q, 3)); // reproducible
  const a = hydrateMcq('card1', Q, 1).options.join(',');
  const b = hydrateMcq('card1', Q, 2).options.join(',');
  const c = hydrateMcq('card1', Q, 3).options.join(',');
  assert.ok(new Set([a, b, c]).size >= 2, 'should vary across exposures'); // not all identical
});

test('hydrateMcq: <2 options is a no-op; seedFrom stable', () => {
  const one = { stem: 's', options: ['only'], answerIndex: 0 };
  assert.deepEqual(hydrateMcq('c', one, 0), one);
  assert.equal(seedFrom('x', 1), seedFrom('x', 1));
  assert.notEqual(seedFrom('x', 1), seedFrom('x', 2));
});

test('hydrateOrder: permutation preserves the set, reproducible by seed', () => {
  const items = [1, 2, 3, 4, 5];
  const o = hydrateOrder(items, 'sess', 0);
  assert.deepEqual([...o].sort((a, b) => a - b), items);
  assert.deepEqual(hydrateOrder(items, 'sess', 0), o);
});

// ---------- Tier 2: similar (cross-lesson, verified) ----------

function makeBundle(dir, name, domain, cards) {
  const b = join(dir, name); mkdirSync(b, { recursive: true });
  writeFileSync(join(b, 'chiron.json'), JSON.stringify({ format: 'chiron-bundle/1', title: name, domain, entry: 'lesson.html' }));
  writeFileSync(join(b, 'lesson.html'), `<title>${name}</title>`);
  writeFileSync(join(b, 'chapter1.json'), JSON.stringify({ chapterId: 'ch1', srCards: cards }));
  const out = join(dir, name + '.chiron');
  execFileSync('zip', ['-r', '-q', '-X', out, '.'], { cwd: b });
  return out;
}

test('byConcept + similar: cross-lesson siblings sharing a concept (different bundles)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chiron-assess-'));
  const src = join(dir, 'src'); mkdirSync(src, { recursive: true });
  makeBundle(src, 'chiron-lessonA', 'medicine', [{ front: 'A: karyotype gold standard?', back: 'x', concept_id: 'dx' }]);
  makeBundle(src, 'chiron-lessonB', 'medicine', [
    { front: 'B: confirmatory test for the syndrome?', back: 'y', concept_id: 'dx' },   // same concept, other lesson
    { front: 'B: unrelated treatment?', back: 'z', concept_id: 'tx' },
  ]);
  const catalogPath = join(dir, 'catalog.db');
  catalogSync({ bundlesDir: join(dir, 'bundles'), catalogPath, bundleSources: [src], looseRoots: [] });

  const cat = openCatalog(catalogPath);
  const aCard = cat.raw.prepare("SELECT id FROM cards WHERE bundle_id='lessonA'").get().id;
  const sib = byConcept(cat, aCard, 5);
  assert.equal(sib.length, 1);                       // only the same-concept card from lessonB
  assert.equal(sib[0].bundle_id, 'lessonB');         // CROSS-lesson
  assert.equal(sib[0].concept_id, 'dx');
  const combined = similar(cat, aCard, 5);
  assert.ok(combined.some((c) => c.bundle_id === 'lessonB')); // surfaced as variety
  assert.ok(!combined.some((c) => c.id === aCard));  // never returns the source itself
  cat.raw.close();
});
