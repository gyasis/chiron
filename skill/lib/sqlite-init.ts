/**
 * Chiron — SQLite initializer (T013).
 *
 * Opens (or creates) `<lesson-output-dir>/.chiron-state.db` and applies the
 * schema verbatim from `specs/001-chiron-v1/contracts/sqlite-schema.sql`.
 *
 * 8 tables only — explicitly NO `llm_usage` / `llm_cache` tables (Q8):
 *   _chiron_meta, quiz_attempts, mastery, chapter_completion,
 *   weakness_log, sr_cards, sr_review_log, bookmarks
 *
 * Migrations are forward-only and idempotent (R-08): every CREATE uses
 * `IF NOT EXISTS`, every seed uses `INSERT OR IGNORE`. Running `initDb` on an
 * already-initialized DB is a no-op aside from cheap PRAGMA application.
 *
 * Per CLAUDE.md: no `console.log` here. Errors propagate.
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the canonical schema at `<repo>/specs/001-chiron-v1/contracts/sqlite-schema.sql`.
 *
 * Source lives at `<repo>/skill/lib/`, but at runtime this is the COMPILED file
 * at `<repo>/skill/dist/lib/` — a different depth. So walk UP from wherever we
 * are until the schema file is found (robust for both src-via-tsx and dist).
 */
function resolveSchemaPath(): string {
  const rel = join('specs', '001-chiron-v1', 'contracts', 'sqlite-schema.sql');
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`sqlite-init: could not locate ${rel} above ${dirname(fileURLToPath(import.meta.url))}`);
}

/**
 * Open (or create) `<lessonDir>/.chiron-state.db` and apply the canonical
 * schema. Returns the live `better-sqlite3` Database handle.
 *
 * Caller is responsible for `db.close()` when done.
 */
export function initDb(lessonDir: string): Database.Database {
  const absLessonDir = resolve(lessonDir);
  mkdirSync(absLessonDir, { recursive: true });

  const dbPath = join(absLessonDir, '.chiron-state.db');
  const db: Database.Database = new Database(dbPath);

  // Pragmas + schema are applied as one transactional batch via exec().
  const schemaSql = readFileSync(resolveSchemaPath(), 'utf-8');
  db.exec(schemaSql);

  // Belt-and-braces: ensure schema_version is seeded even if the SQL file is
  // ever edited to drop the seed line. Idempotent on already-seeded DBs.
  const seedMeta = db.prepare(
    `INSERT OR IGNORE INTO _chiron_meta (key, value) VALUES (?, ?)`
  );
  seedMeta.run('schema_version', '1');

  return db;
}

/** Convenience export — current shipping schema version. */
export const CHIRON_SCHEMA_VERSION = '1';
