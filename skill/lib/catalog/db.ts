/**
 * Chiron catalog — open/init the central catalog.db (storage-consolidation PRD).
 *
 * The catalog is a LOCAL, never-synced, rebuildable materialized view. We create
 * tables via idempotent raw DDL (matching lib/catalog/schema.ts) — consistent
 * with chiron's existing IF-NOT-EXISTS / forward-only convention — then wrap the
 * better-sqlite3 handle with Drizzle for typed queries. No drizzle-kit migration
 * step needed (the DB is disposable: delete + rebuild from bundles + events).
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

const DDL = `
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY, title TEXT, domain TEXT, version TEXT, hash TEXT,
  bundle_path TEXT, size_mb REAL, clips INTEGER, card_count INTEGER,
  catalog_tier INTEGER, created_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, title TEXT, sort_order INTEGER);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, chapter_id TEXT, concept_id TEXT,
  card_type TEXT, front TEXT, back TEXT, media_ref TEXT, tags TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS card_tags (card_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT);
CREATE INDEX IF NOT EXISTS idx_cards_bundle ON cards(bundle_id);
CREATE INDEX IF NOT EXISTS idx_cards_concept ON cards(concept_id);
CREATE INDEX IF NOT EXISTS idx_card_tags ON card_tags(key, value);

CREATE TABLE IF NOT EXISTS sr_cards (
  card_id TEXT PRIMARY KEY, ease_factor REAL DEFAULT 2.5, interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0, next_due_at INTEGER, last_reviewed_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_sr_due ON sr_cards(next_due_at);
CREATE TABLE IF NOT EXISTS bookmarks (card_id TEXT PRIMARY KEY, created_at INTEGER);
CREATE TABLE IF NOT EXISTS chapter_completion (chapter_id TEXT PRIMARY KEY, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS tombstone_events (rowid INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, raw TEXT);
`;

export interface Catalog {
  raw: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function openCatalog(path: string): Catalog {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.exec(DDL);
  raw.exec(schema.FTS_AND_META_DDL);
  const db = drizzle(raw, { schema });
  return { raw, db };
}
