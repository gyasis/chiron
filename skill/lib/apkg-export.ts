/**
 * Chiron — Anki .apkg exporter (T120, v1 STUB).
 *
 * v1 stub. Real .apkg builder requires writing a sub-SQLite file (collection.anki2)
 * and ZIP-bundling per Anki spec. Tracked as a stretch goal in spec.md.
 * The stub captures what would be exported in a `.pending.json` sidecar so a
 * future implementation can pick up where v1 left off.
 *
 * Card-type mapping (applied when real impl lands):
 *   chiron 'term-def'     -> Anki "Basic" model
 *   chiron 'cloze'        -> Anki "Cloze" model (preserves Anki cloze syntax)
 *   chiron 'code-output'  -> Anki "Basic" with code formatting
 *   chiron 'code-bug'     -> Anki "Basic"
 *   chiron 'vignette'     -> Anki "Basic" (long-form question)
 *   chiron 'vocab'        -> Anki "Basic" with `lang` attribute
 *   chiron 'conjugation'  -> Anki "Basic"
 *   chiron 'mechanism'    -> Anki "Basic"
 *   chiron 'dose-fact'    -> Anki "Basic"
 *   chiron 'methodology'  -> Anki "Basic"
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { initDb } from './sqlite-init.js';

/** Mapping: chiron card_type -> Anki model name. Consumed by the future real builder. */
export const CHIRON_TO_ANKI_MODEL: Record<string, string> = {
  'term-def': 'Basic',
  'cloze': 'Cloze',
  'code-output': 'Basic',
  'code-bug': 'Basic',
  'vignette': 'Basic',
  'vocab': 'Basic',
  'conjugation': 'Basic',
  'mechanism': 'Basic',
  'dose-fact': 'Basic',
  'methodology': 'Basic',
};

export interface ApkgExportOptions {
  lessonOutputDir: string;
  outputApkgPath: string;
  deckName?: string;
  mediaFiles?: string[];
}

export interface ApkgExportResult {
  outputApkgPath: string;
  cardCount: number;
  warnings: string[];
}

/**
 * v1 STUB. Reads sr_cards from the chiron-state DB, counts by card_type, and
 * writes a `.pending.json` sidecar describing what a real .apkg builder would
 * emit. Does NOT produce a binary .apkg yet.
 */
export async function exportToApkg(opts: ApkgExportOptions): Promise<ApkgExportResult> {
  const lessonDir = resolve(opts.lessonOutputDir);
  const outputApkgPath = resolve(opts.outputApkgPath);
  const deckName = opts.deckName ?? `Chiron Lesson — ${basename(lessonDir)}`;
  const mediaFiles = opts.mediaFiles ?? [];

  const db = initDb(lessonDir);
  let cardCount = 0;
  const byCardType: Record<string, number> = {};

  try {
    const rows = db
      .prepare(`SELECT card_type FROM sr_cards`)
      .all() as Array<{ card_type: string }>;
    cardCount = rows.length;
    for (const row of rows) {
      const t = row.card_type ?? 'unknown';
      byCardType[t] = (byCardType[t] ?? 0) + 1;
    }
  } finally {
    db.close();
  }

  const sidecarPath = `${outputApkgPath}.pending.json`;
  const sidecar = {
    deckName,
    cardCount,
    byCardType,
    media: mediaFiles,
    format: 'apkg-v2.1-target',
    implementationStatus: 'stub-pending-real-apkg-builder',
    cardTypeToAnkiModel: CHIRON_TO_ANKI_MODEL,
    todos: [
      'Add genanki-style table inserts: cards, notes, decks, models',
      'Bundle SHA1-keyed media filenames',
      'Wrap in ZIP with collection.anki2 + media + media-index',
    ],
  };

  mkdirSync(dirname(sidecarPath), { recursive: true });
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8');

  const warnings = [
    `v1 stub — real .apkg writer pending; see ${sidecarPath}`,
  ];

  return { outputApkgPath, cardCount, warnings };
}
