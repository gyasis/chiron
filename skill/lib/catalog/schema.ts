/**
 * Chiron catalog — Drizzle schema (storage-consolidation PRD §4).
 *
 * Defined with drizzle-orm/sqlite-core so the SAME schema lifts to Postgres
 * later (PRD §7 multi-user on-ramp) by swapping the driver, not the queries.
 * FTS5 is a virtual table Drizzle doesn't model — created via raw SQL in
 * `openCatalog()`.
 *
 * Two halves:
 *  - bundle-derived (static): bundles, chapters, cards, card_tags  — from scanning .chiron
 *  - event-derived (materialized): sr_cards, bookmarks, chapter_completion, tombstone_events
 *    — rebuilt by replaying the JSONL event log through lib/sr-scheduler.ts nextDue().
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ---------- bundle-derived ----------

export const bundles = sqliteTable('bundles', {
  id: text('id').primaryKey(), // stable author/content id (PRD §5)
  title: text('title'),
  domain: text('domain'),
  version: text('version'),
  hash: text('hash'), // content hash — detect re-scan need
  bundlePath: text('bundle_path'), // local path or (later) S3 key
  sizeMb: real('size_mb'),
  clips: integer('clips'),
  cardCount: integer('card_count'),
  catalogTier: integer('catalog_tier'), // best card-id tier achieved (1/2/3)
  createdAt: integer('created_at'),
  meta: text('meta'), // JSON — domain-specific facets
});

export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(), // <bundle_id>:<chapterId|index>
  bundleId: text('bundle_id').notNull(),
  title: text('title'),
  sortOrder: integer('sort_order'),
});

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(), // PRD §12 ladder: <concept>:<ord> | <bundle>:<chap>:<ord> | <bundle>:<hash>
  bundleId: text('bundle_id').notNull(),
  chapterId: text('chapter_id'),
  conceptId: text('concept_id'),
  cardType: text('card_type'),
  front: text('front'),
  back: text('back'),
  mediaRef: text('media_ref'),
  tags: text('tags'), // JSON array
  meta: text('meta'), // JSON
});

export const cardTags = sqliteTable('card_tags', {
  cardId: text('card_id').notNull(),
  key: text('key').notNull(),
  value: text('value'),
});

// ---------- event-derived (materialized view of the JSONL log) ----------

export const srCards = sqliteTable('sr_cards', {
  cardId: text('card_id').primaryKey(),
  easeFactor: real('ease_factor').default(2.5),
  intervalDays: integer('interval_days').default(0),
  repetitions: integer('repetitions').default(0),
  nextDueAt: integer('next_due_at'),
  lastReviewedAt: integer('last_reviewed_at'),
});

export const bookmarks = sqliteTable('bookmarks', {
  cardId: text('card_id').primaryKey(),
  createdAt: integer('created_at'),
});

export const chapterCompletion = sqliteTable('chapter_completion', {
  chapterId: text('chapter_id').primaryKey(),
  completedAt: integer('completed_at'),
});

export const tombstoneEvents = sqliteTable('tombstone_events', {
  rowid: integer('rowid').primaryKey({ autoIncrement: true }),
  cardId: text('card_id'),
  raw: text('raw'),
});

// FTS5 virtual table + the catalog meta — created via raw SQL (Drizzle can't model FTS5).
export const FTS_AND_META_DDL = `
CREATE TABLE IF NOT EXISTS _catalog_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  card_id UNINDEXED, front, back, tags
);
`;
