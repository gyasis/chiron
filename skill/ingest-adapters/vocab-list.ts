// Stage 0 INGEST adapter — vocab-list (FR-032 g)
//
// Parses a CSV vocabulary list with optional headers and produces a `Brief`
// with `sourceType: 'vocab-list'`. The source CSV is copied into
// `<lesson-output-dir>/source/<basename>` per FR-030; `sourceCopiedTo` is
// set to that path (project-relative when possible).
//
// German is deferred to post-v1 (per project CLAUDE.md): if the target
// language is detected as `de` (via opts or filename), this adapter throws.
//
// Stage 0 is deterministic — NO LLM calls. Node built-ins only.

import {
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { resolve, basename, join, dirname } from 'node:path';

import type { Brief } from '../lib/schemas/brief.js';

// ---------- CSV tokenizer (RFC 4180-ish, minimal) ----------

/**
 * Parse CSV text into a 2-D array. Handles:
 *   - quoted fields ("..."), with escaped quotes (""),
 *   - commas inside quotes,
 *   - CRLF or LF line endings,
 *   - trailing blank lines.
 * No external deps.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip BOM if present.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r') {
      // Treat \r\n or bare \r as row terminator.
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      if (text[i] === '\n') i++;
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += c;
      i++;
    }
  }

  // Flush trailing field/row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop wholly empty trailing rows (a single empty cell from a final newline).
  while (
    rows.length > 0 &&
    rows[rows.length - 1]!.length === 1 &&
    rows[rows.length - 1]![0] === ''
  ) {
    rows.pop();
  }

  return rows;
}

// ---------- Header detection ----------

const HEADER_KEYWORDS = new Set<string>([
  'word', 'english', 'l1', 'l2', 'target', 'source',
  'italian', 'german', 'deutsch', 'italiano',
  'translation', 'meaning', 'pos', 'partofspeech', 'part_of_speech',
  'example', 'examplesentence', 'example_sentence',
  'grammar', 'grammartag', 'grammar_tag', 'tag', 'notes',
]);

function looksLikeHeader(firstRow: string[]): boolean {
  if (firstRow.length === 0) return false;
  for (const cell of firstRow) {
    const norm = cell.trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (HEADER_KEYWORDS.has(norm)) return true;
  }
  return false;
}

// ---------- Language refusal (German deferred) ----------

function detectGerman(
  filename: string,
  headers: string[] | null,
  explicit: 'it' | 'de' | undefined,
): boolean {
  if (explicit === 'de') return true;
  const lower = filename.toLowerCase();
  if (/(^|[\W_])(de|ger|deu|deutsch|german)([\W_]|\.|$)/.test(lower)) {
    return true;
  }
  if (headers) {
    for (const h of headers) {
      const norm = h.trim().toLowerCase();
      if (norm === 'german' || norm === 'deutsch' || norm === 'de') return true;
    }
  }
  return false;
}

// T156: content-based German detection — prevents Italian-flag bypass.
interface ParsedEntry {
  l1: string;
  l2: string;
}

function looksGerman(entries: ParsedEntry[]): boolean {
  if (entries.length < 5) return false;
  let germanScore = 0;
  for (const e of entries) {
    const text = ((e.l1 ?? '') + ' ' + (e.l2 ?? '')).toLowerCase();
    // Umlauts and ß are highly distinctive.
    if (/[äöüß]/.test(text)) germanScore += 2;
    // Common German articles.
    if (/\b(der|die|das|den|dem|des)\b/.test(text)) germanScore += 1;
    // Capitalized common nouns (German rule) — heuristic on the L2 column.
    if (/^[A-Z][a-zäöü]+/.test(e.l2 ?? '')) germanScore += 0.3;
  }
  // If score-per-entry > 0.5, refuse.
  return germanScore / entries.length > 0.5;
}

// ---------- Public API ----------

export interface IngestVocabListOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  targetLanguage?: 'it' | 'de';
}

export function ingestVocabList(opts: IngestVocabListOptions): Brief {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestVocabList: sourcePath does not exist: ${absInput}`);
  }
  const st = statSync(absInput);
  if (!st.isFile()) {
    throw new Error(`ingestVocabList: sourcePath is not a file: ${absInput}`);
  }

  const raw = readFileSync(absInput, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    throw new Error(`ingestVocabList: CSV is empty: ${absInput}`);
  }

  // Detect headers heuristically.
  const headerRow = looksLikeHeader(rows[0]!);
  const headers = headerRow ? rows[0]!.map((h) => h.trim()) : null;
  const dataRows = headerRow ? rows.slice(1) : rows;

  // German refusal — check filename, headers, and explicit option.
  if (detectGerman(basename(absInput), headers, opts.targetLanguage)) {
    throw new Error(
      'ingestVocabList: German vocab ingest is deferred to post-v1 (see CLAUDE.md). ' +
        'Only Italian (it) is supported in v1.',
    );
  }

  const targetLanguage: 'it' | 'de' | null =
    opts.targetLanguage === 'it' ? 'it' : opts.targetLanguage === 'de' ? 'de' : null;

  // Column count is the max width across all rows (CSVs are sometimes ragged).
  let columnCount = 0;
  for (const r of rows) if (r.length > columnCount) columnCount = r.length;

  // Build extractedText. Default column order: L1, L2, [pos], [example], [grammar].
  // We do not attempt header-aware column re-mapping in v1 — slot positions are
  // assumed: 0 = L1 (source), 1 = L2 (target), 2 = pos, 3 = example, 4 = grammar.
  const lines: string[] = [];
  lines.push(`Vocab list (${dataRows.length} entries):`);
  let hasExamples = false;
  const parsedEntries: ParsedEntry[] = [];
  dataRows.forEach((r, idx) => {
    const l1 = (r[0] ?? '').trim();
    const l2 = (r[1] ?? '').trim();
    const pos = (r[2] ?? '').trim();
    const example = (r[3] ?? '').trim();
    if (example !== '') hasExamples = true;
    parsedEntries.push({ l1, l2 });
    let line = `${idx + 1}. ${l1} = ${l2}`;
    if (pos !== '') line += ` [${pos}]`;
    if (example !== '') line += ` — example: "${example}"`;
    lines.push(line);
  });
  const extractedText = lines.join('\n');

  // T156: content-based German detection — prevents Italian-flag bypass.
  if (looksGerman(parsedEntries)) {
    throw new Error(
      'ingestVocabList: German vocab ingest is deferred to post-v1 (see CLAUDE.md). ' +
        'Only Italian (it) is supported in v1. ' +
        '[code: german-deferred-to-post-v1]',
    );
  }

  // Sample: first 3 data rows (echo for downstream prompts / debug).
  const sample = dataRows.slice(0, 3).map((r) => r.map((c) => c.trim()));

  // FR-030: copy source into <lessonOutputDir>/source/<basename>.
  // We use sync fs here so the public API can stay synchronous (matches
  // code-repo.ts adapter shape). `lib/source-copy.ts` exposes only an async
  // API; see "contract gaps" in the task summary.
  const absLessonDir = resolve(opts.lessonOutputDir);
  const destDir = join(absLessonDir, 'source');
  mkdirSync(destDir, { recursive: true });
  const destAbs = join(destDir, basename(absInput));
  // Avoid copying onto itself if source is already inside the lesson dir.
  if (resolve(destAbs) !== absInput) {
    mkdirSync(dirname(destAbs), { recursive: true });
    copyFileSync(absInput, destAbs);
  }
  // Project-relative path when possible (relative to the lesson output dir).
  const sourceCopiedTo = join('source', basename(absInput));

  const brief: Brief = {
    domain: 'language-it',
    mode: opts.mode,
    sourceType: 'vocab-list',
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText,
    metadata: {
      entryCount: dataRows.length,
      headerRow,
      columnCount,
      targetLanguage,
      sample,
      hasExamples,
      ...(headers ? { headers } : {}),
    },
    briefSchemaVersion: '1',
  };

  return brief;
}
