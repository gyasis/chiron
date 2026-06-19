/**
 * Chiron catalog — consolidate + index (storage-consolidation PRD §9, §12).
 *
 * Two phases:
 *  1. CONSOLIDATE — gather every lesson into ONE bundles dir as `.chiron` zips:
 *     copy existing `.chiron` bundles; zip each loose `lessons/<x>/` dir
 *     (synthesizing a minimal chiron.json from brief.json + the html <title>).
 *  2. INDEX — scan the bundles dir into catalog.db: title/domain from chiron.json,
 *     chapters+cards from `chapter*.json` (medicine layout) via the card-id ladder,
 *     or lesson-level only (Tier 3) for bundles with no structured cards.
 *
 * Uses the system `zip`/`unzip` (no JS zip dependency for this CLI). The catalog
 * is rebuildable, so this is idempotent: re-running re-indexes from scratch.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync, cpSync, rmSync,
} from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openCatalog, type Catalog } from './db.js';
import { resolveCardId, bundleIdFromName } from './ids.js';

// ---------- zip helpers (system zip/unzip) ----------

function zipList(bundle: string): string[] {
  try {
    return execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/'));
  } catch { return []; }
}
function zipRead(bundle: string, member: string): string | null {
  try { return execFileSync('unzip', ['-p', bundle, member], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return null; }
}
function zipDir(dir: string, outFile: string): void {
  if (existsSync(outFile)) execFileSync('rm', ['-f', outFile]);
  execFileSync('zip', ['-r', '-q', '-X', outFile, '.'], { cwd: dir });
}

function htmlTitle(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1]!.trim() : null;
}
function shortHash(s: string): string { return createHash('sha256').update(s).digest('hex').slice(0, 12); }

// ---------- consolidate ----------

export interface ConsolidateOptions {
  /** existing `.chiron` bundle source dirs (e.g. player/lessons). */
  bundleSources: string[];
  /** loose lesson dirs root(s) (e.g. lessons/) — each immediate subdir is a lesson. */
  looseRoots: string[];
  /** target consolidated bundles dir (Syncthing-synced home). */
  bundlesDir: string;
}

export interface ConsolidateResult {
  bundlePaths: string[];
  duplicates: Array<{ bundleId: string; paths: string[] }>;
}

export function consolidate(opts: ConsolidateOptions): ConsolidateResult {
  mkdirSync(opts.bundlesDir, { recursive: true });
  const byId = new Map<string, string[]>();

  const place = (srcPath: string, name: string) => {
    const id = bundleIdFromName(name);
    const dest = join(opts.bundlesDir, `${id}.chiron`);
    if (existsSync(dest)) { (byId.get(id) ?? byId.set(id, []).get(id)!).push(srcPath); return; }
    copyFileSync(srcPath, dest);
    byId.set(id, [...(byId.get(id) ?? []), srcPath]);
  };

  // 1. existing .chiron bundles
  for (const dir of opts.bundleSources) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.chiron')) place(join(dir, f), f);
    }
  }

  // 2. loose lesson dirs → synthesize chiron.json + zip into a .chiron
  for (const root of opts.looseRoots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const entry = ['lesson.html', 'index.html'].find((e) => existsSync(join(dir, e)));
      if (!entry) continue;
      const id = bundleIdFromName(name);
      const dest = join(opts.bundlesDir, `${id}.chiron`);
      if (existsSync(dest)) { byId.set(id, [...(byId.get(id) ?? []), dir]); continue; } // a bundle already won
      // Stage into a temp dir (NON-destructive — never mutate the source repo),
      // synthesize chiron.json there if absent, then zip the staging copy.
      const stage = join(tmpdir(), `chiron-stage-${id}-${process.pid}`);
      rmSync(stage, { recursive: true, force: true });
      cpSync(dir, stage, { recursive: true });
      if (!existsSync(join(stage, 'chiron.json'))) {
        let domain = 'unknown';
        const briefP = join(stage, 'brief.json');
        if (existsSync(briefP)) { try { domain = JSON.parse(readFileSync(briefP, 'utf8')).domain ?? 'unknown'; } catch { /* */ } }
        const title = htmlTitle(readFileSync(join(stage, entry), 'utf8')) ?? name;
        writeFileSync(join(stage, 'chiron.json'),
          JSON.stringify({ format: 'chiron-bundle/1', title, entry, domain, created: null, generator: 'consolidate-synth' }, null, 2));
      }
      zipDir(stage, dest);
      rmSync(stage, { recursive: true, force: true });
      byId.set(id, [...(byId.get(id) ?? []), dir]);
    }
  }

  const duplicates = [...byId.entries()].filter(([, p]) => p.length > 1).map(([bundleId, paths]) => ({ bundleId, paths }));
  const bundlePaths = readdirSync(opts.bundlesDir).filter((f) => f.endsWith('.chiron')).map((f) => join(opts.bundlesDir, f));
  return { bundlePaths, duplicates };
}

// ---------- index ----------

export interface IndexResult { bundleId: string; domain: string; chapters: number; cards: number; tier: number; }

export function indexBundle(cat: Catalog, bundlePath: string): IndexResult {
  const id = bundleIdFromName(basename(bundlePath));
  const members = zipList(bundlePath);
  const manifestRaw = zipRead(bundlePath, 'chiron.json');
  const manifest = manifestRaw ? JSON.parse(manifestRaw) : {};
  const title: string = manifest.title ?? id;
  const domain: string = manifest.domain ?? 'unknown';
  const sizeMb = +(statSync(bundlePath).size / 1048576).toFixed(2);
  const clips = members.filter((m) => m.startsWith('audio/') && m.endsWith('.mp3')).length;

  const raw = cat.raw;
  // clear prior rows for this bundle (idempotent re-index)
  for (const t of ['cards', 'chapters']) raw.prepare(`DELETE FROM ${t} WHERE bundle_id = ?`).run(id);
  raw.prepare('DELETE FROM card_tags WHERE card_id LIKE ?').run(`${id}:%`);
  raw.prepare('DELETE FROM cards_fts WHERE card_id LIKE ?').run(`${id}:%`);

  const chapterFiles = members.filter((m) => /^chapter.*\.json$/i.test(m)).sort();
  let cardCount = 0; let bestTier = 3;
  const conceptOrd = new Map<string, number>(); // bundle-wide stable per-concept ordinal

  const insChapter = raw.prepare('INSERT OR REPLACE INTO chapters (id,bundle_id,title,sort_order) VALUES (?,?,?,?)');
  const insCard = raw.prepare('INSERT OR REPLACE INTO cards (id,bundle_id,chapter_id,concept_id,card_type,front,back,media_ref,tags,meta) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insFts = raw.prepare('INSERT INTO cards_fts (card_id,front,back,tags) VALUES (?,?,?,?)');
  const insTag = raw.prepare('INSERT INTO card_tags (card_id,key,value) VALUES (?,?,?)');

  raw.transaction(() => {
    chapterFiles.forEach((cf, ci) => {
      let ch: Record<string, unknown>;
      try { ch = JSON.parse(zipRead(bundlePath, cf) ?? '{}'); } catch { return; }
      const chapterId = `${id}:${(ch.chapterId as string) ?? `ch${ci}`}`;
      insChapter.run(chapterId, id, (ch.title as string) ?? `Chapter ${ci + 1}`, (ch.chapterNumber as number) ?? ci);
      const srCards = Array.isArray(ch.srCards) ? (ch.srCards as Array<Record<string, unknown>>) : [];
      srCards.forEach((card, oi) => {
        // Stable per-concept ordinal (not chapter position) so a Tier-1 id is
        // stable across reordering; falls back to chapter position when no concept.
        const concept = (card.concept_id as string) ?? (card.conceptId as string);
        let ord = oi;
        if (concept) { ord = conceptOrd.get(concept) ?? 0; conceptOrd.set(concept, ord + 1); }
        const { id: cardId, tier } = resolveCardId(id, { ...card, chapterId: (ch.chapterId as string) ?? `ch${ci}` } as never, ord);
        bestTier = Math.min(bestTier, tier);
        const tags = Array.isArray(card.tags) ? (card.tags as string[]) : [];
        insCard.run(cardId, id, chapterId, (card.concept_id as string) ?? (card.conceptId as string) ?? null,
          (card.cardType as string) ?? (card.type as string) ?? null,
          (card.front as string) ?? null, (card.back as string) ?? null, null, JSON.stringify(tags), null);
        insFts.run(cardId, (card.front as string) ?? '', (card.back as string) ?? '', tags.join(' '));
        for (const t of tags) insTag.run(cardId, 'tag', t);
        cardCount++;
      });
    });
  })();

  raw.prepare(`INSERT OR REPLACE INTO bundles
    (id,title,domain,version,hash,bundle_path,size_mb,clips,card_count,catalog_tier,created_at,meta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, title, domain, (manifest.format as string) ?? null, shortHash(members.join('|')),
      resolve(bundlePath), sizeMb, clips, cardCount, cardCount > 0 ? bestTier : 3,
      (manifest.created as number) ?? null, JSON.stringify({ entry: manifest.entry ?? 'lesson.html' }));

  return { bundleId: id, domain, chapters: chapterFiles.length, cards: cardCount, tier: cardCount > 0 ? bestTier : 3 };
}

export interface CatalogSyncOptions extends ConsolidateOptions { catalogPath: string; }

export function catalogSync(opts: CatalogSyncOptions): { consolidated: ConsolidateResult; indexed: IndexResult[] } {
  const consolidated = consolidate(opts);
  const cat = openCatalog(opts.catalogPath);
  const indexed = consolidated.bundlePaths.map((p) => indexBundle(cat, p));
  // registry for cross-device discovery (PRD §3)
  const registry = indexed.map((r) => {
    const row = cat.raw.prepare('SELECT title,domain,bundle_path,hash FROM bundles WHERE id=?').get(r.bundleId) as Record<string, unknown>;
    return JSON.stringify({ id: r.bundleId, title: row.title, domain: row.domain, hash: row.hash, cards: r.cards, tier: r.tier });
  }).join('\n');
  writeFileSync(join(opts.bundlesDir, 'bundles.jsonl'), registry + '\n');
  cat.raw.close();
  return { consolidated, indexed };
}
