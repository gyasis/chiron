#!/usr/bin/env node
// Chiron catalog CLI (storage-consolidation PRD §9).
//
//   chiron-catalog sync    [--bundles <dir>] [--catalog <db>] [--sources d1,d2] [--loose r1,r2]
//   chiron-catalog replay  [--catalog <db>] [--events <dir>]
//   chiron-catalog due     [--catalog <db>] [--limit N]
//
// Defaults assume the consolidated home at ~/chiron/ (Syncthing-synced):
//   bundles → ~/chiron/bundles/   events → ~/chiron/events/   catalog → ~/chiron/catalog.db
// Sources for the first consolidation default to this repo's player + lessons/.
//
// Uses the COMPILED lib (run `npx tsc` first).

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { openCatalog } from '../dist/lib/catalog/db.js';
import { catalogSync } from '../dist/lib/catalog/sync.js';
import { replay, due } from '../dist/lib/catalog/sr.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const HOME = join(homedir(), 'chiron');
const cmd = process.argv[2];

if (cmd === 'sync') {
  const bundlesDir = resolve(arg('bundles', join(HOME, 'bundles')));
  const catalogPath = resolve(arg('catalog', join(HOME, 'catalog.db')));
  const skillDir = resolve(new URL('..', import.meta.url).pathname);
  const bundleSources = (arg('sources', join(skillDir, 'player/lessons'))).split(',').filter(Boolean);
  const looseRoots = (arg('loose', join(skillDir, '..', 'lessons'))).split(',').filter(Boolean);
  const { consolidated, indexed } = catalogSync({ bundlesDir, catalogPath, bundleSources, looseRoots });
  console.log(`\n📚 Consolidated ${consolidated.bundlePaths.length} bundle(s) → ${bundlesDir}`);
  for (const r of indexed) console.log(`   ${r.bundleId.padEnd(40)} domain=${r.domain.padEnd(11)} chapters=${r.chapters} cards=${r.cards} tier=${r.tier}`);
  if (consolidated.duplicates.length) {
    console.log('\n⚠️  Possible duplicates (NOT removed — review):');
    for (const d of consolidated.duplicates) console.log(`   ${d.bundleId}: ${d.paths.length} sources\n     ${d.paths.join('\n     ')}`);
  }
  console.log(`\n✅ catalog.db at ${catalogPath} · registry at ${join(bundlesDir, 'bundles.jsonl')}`);
} else if (cmd === 'replay') {
  const catalogPath = resolve(arg('catalog', join(HOME, 'catalog.db')));
  const eventsDir = resolve(arg('events', join(HOME, 'events')));
  const cat = openCatalog(catalogPath);
  const r = replay(cat, eventsDir);
  cat.raw.close();
  console.log(`🔁 replayed ${r.events} event(s) → ${r.cards} sr_cards materialized (${r.tombstoned} tombstoned)`);
} else if (cmd === 'due') {
  const catalogPath = resolve(arg('catalog', join(HOME, 'catalog.db')));
  const limit = Number(arg('limit', '50'));
  const cat = openCatalog(catalogPath);
  const rows = due(cat, Date.now(), limit);
  cat.raw.close();
  console.log(`⏰ ${rows.length} card(s) due across all lessons:`);
  for (const c of rows) console.log(`   [${c.domain}] ${c.bundle_id} :: ${(c.front || '').slice(0, 70)}`);
} else {
  console.log('usage: chiron-catalog <sync|replay|due> [--bundles --catalog --events --sources --loose --limit]');
  process.exit(cmd ? 1 : 0);
}
