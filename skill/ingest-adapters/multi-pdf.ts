/**
 * Chiron — multi-PDF ingest adapter (T072, FR-032 e).
 *
 * Accepts an ordered list of PDFs, a directory of PDFs (alphabetical order),
 * or a `.txt`/`.json` manifest file pointing at PDFs (user-controlled order).
 *
 * Delegates each individual PDF to `./pdf.ts#ingestPdf`, then concatenates the
 * per-PDF `extractedText` in the supplied order, prefixing each block with a
 * `=== Source N: <basename> ===` separator.
 *
 * Per-file provenance is captured in `Brief.sourceManifest[]` (FR-034) — one
 * `SourceFileEntry` per source PDF — so downstream stages can attribute
 * content back to its origin.
 *
 * Note: this adapter does NOT call any MCP tools directly. The text-vs-vision
 * extractor decision and any vision-handoff scaffolding is delegated to
 * `ingestPdf`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ingestPdf } from './pdf.js';
import type { Brief, Domain, SourceFileEntry } from '../lib/schemas/brief.js';
import { stage, progress } from '../lib/progress.js';

export interface IngestMultiPdfOpts {
  /**
   * One of:
   *  - `string[]` — explicit ordered list of PDF paths.
   *  - directory path — all `*.pdf` files inside (sorted alphabetically).
   *  - manifest file path (`.txt` or `.json`) — one PDF path per line / JSON
   *    array of strings; preserves user-controlled order.
   */
  sourcePath: string | string[];
  /** Lesson output directory (root). Per-PDF scratch dirs created beneath. */
  lessonOutputDir: string;
  /** Lesson mode (A = course, B = case-study). */
  mode: 'A' | 'B';
  /**
   * Resolved Chiron domain — caller MUST supply. Threaded through to each
   * per-PDF `ingestPdf` call AND set on the aggregate Brief. All PDFs in a
   * multi-pdf bundle share a single domain by construction; if domains
   * differ, callers should split into separate ingests.
   */
  domain: Domain;
}

interface ResolveResult {
  /** Ordered absolute (or as-supplied) PDF paths. */
  pdfs: string[];
  /** A representative `sourcePath` string to record on the aggregate Brief. */
  representativePath: string;
}

/**
 * Resolve `opts.sourcePath` into an ordered list of PDF file paths.
 * Pure I/O — does not parse PDF content.
 */
function resolvePdfList(sourcePath: string | string[]): ResolveResult {
  // Case 1: explicit ordered list — use as-is.
  if (Array.isArray(sourcePath)) {
    if (sourcePath.length === 0) {
      throw new Error('multi-pdf: sourcePath array is empty');
    }
    return {
      pdfs: sourcePath.slice(),
      representativePath: `[multi-pdf list: ${sourcePath.length} files]`,
    };
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`multi-pdf: sourcePath does not exist: ${sourcePath}`);
  }

  const stat = fs.statSync(sourcePath);

  // Case 2: directory — list `*.pdf` files alphabetically.
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(sourcePath)
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort((a, b) => a.localeCompare(b));
    if (entries.length === 0) {
      throw new Error(`multi-pdf: no .pdf files found in directory: ${sourcePath}`);
    }
    return {
      pdfs: entries.map((name) => path.join(sourcePath, name)),
      representativePath: sourcePath,
    };
  }

  // Case 3: manifest file (`.txt` or `.json`).
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.json') {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`multi-pdf: failed to parse JSON manifest ${sourcePath}: ${msg}`);
    }
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
      throw new Error(
        `multi-pdf: JSON manifest must be an array of string paths: ${sourcePath}`,
      );
    }
    const list = parsed as string[];
    if (list.length === 0) {
      throw new Error(`multi-pdf: JSON manifest is empty: ${sourcePath}`);
    }
    return {
      pdfs: list.map((p) => resolveManifestEntry(sourcePath, p)),
      representativePath: sourcePath,
    };
  }
  if (ext === '.txt') {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const list = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (list.length === 0) {
      throw new Error(`multi-pdf: text manifest has no PDF entries: ${sourcePath}`);
    }
    return {
      pdfs: list.map((p) => resolveManifestEntry(sourcePath, p)),
      representativePath: sourcePath,
    };
  }

  throw new Error(
    `multi-pdf: sourcePath must be an array, a directory, or a .txt/.json manifest — got: ${sourcePath}`,
  );
}

/** Resolve a manifest entry relative to the manifest file's own directory. */
function resolveManifestEntry(manifestPath: string, entry: string): string {
  if (path.isAbsolute(entry)) return entry;
  return path.resolve(path.dirname(manifestPath), entry);
}

/**
 * Map a per-PDF Brief's `sourceType` onto a `SourceFileEntry.extractor`.
 * Defaults to `text-pdf` when the per-PDF Brief did not specify.
 */
function pickExtractor(perPdfSourceType: string | undefined): SourceFileEntry['extractor'] {
  if (perPdfSourceType === 'pdf-scanned') return 'vision-pdf';
  return 'text-pdf';
}

/**
 * Approximate token count from a character count. Standard 4 chars/token
 * heuristic — good enough for manifest provenance; the LLM gateway computes
 * exact counts when it actually sends text.
 */
function approxTokens(charCount: number): number {
  return Math.max(0, Math.ceil(charCount / 4));
}

/**
 * Multi-PDF ingest entry point.
 *
 * Resolves the input into an ordered PDF list, delegates each one to
 * `ingestPdf`, then folds the results into a single aggregate `Brief`.
 */
export async function ingestMultiPdf(opts: IngestMultiPdfOpts): Promise<Brief> {
  const { lessonOutputDir, mode, domain } = opts;
  const { pdfs, representativePath } = resolvePdfList(opts.sourcePath);
  const total = pdfs.length;

  stage(0, 5, `ingest: multi-pdf (${total} files)`);

  const scratchRoot = path.join(lessonOutputDir, '.scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });

  const textBlocks: string[] = [];
  const manifest: SourceFileEntry[] = [];
  const perPdfMetadata: Array<Record<string, unknown>> = [];

  let totalPages = 0;
  let hasAnyVisionExtraction = false;
  let primaryLanguage: string | undefined;

  for (let i = 0; i < total; i++) {
    const pdfPath = pdfs[i];
    const basename = path.basename(pdfPath);
    progress(`stage 0/5 doc ${i + 1}/${total}`, basename);

    const subDir = path.join(scratchRoot, `pdf-${i + 1}`);
    fs.mkdirSync(subDir, { recursive: true });

    const perPdfBrief = await ingestPdf({
      sourcePath: pdfPath,
      lessonOutputDir: subDir,
      mode,
      domain,
    });

    const extracted = perPdfBrief.extractedText ?? '';
    textBlocks.push(`=== Source ${i + 1}: ${basename} ===\n${extracted}`);

    const extractor = pickExtractor(perPdfBrief.sourceType as unknown as string);
    if (extractor === 'vision-pdf') hasAnyVisionExtraction = true;

    manifest.push({
      path: pdfPath,
      role: 'primary',
      extractor,
      tokenCount: approxTokens(extracted.length),
      extractedAt: Date.now(),
    });

    // Aggregate metadata
    perPdfMetadata.push(perPdfBrief.metadata ?? {});
    const md = (perPdfBrief.metadata ?? {}) as Record<string, unknown>;
    if (typeof md.pageCount === 'number') totalPages += md.pageCount;
    if (!primaryLanguage && typeof md.primaryLanguage === 'string') {
      primaryLanguage = md.primaryLanguage;
    }
  }

  const concatenated = textBlocks.join('\n\n');

  const aggregateMetadata: Record<string, unknown> = {
    pdfCount: total,
    totalPages,
    hasAnyVisionExtraction,
    primaryLanguage: primaryLanguage ?? null,
    perPdfMetadata,
  };

  // Domain is supplied by the caller (trigger-context layer) and threaded
  // into every per-PDF ingest above. All PDFs in a multi-pdf bundle share a
  // single domain by construction.
  const brief: Brief = {
    domain,
    mode,
    sourceType: 'multi-pdf',
    sourcePath: typeof opts.sourcePath === 'string' ? representativePath : representativePath,
    sourceCopiedTo: null,
    extractedText: concatenated,
    sourceManifest: manifest,
    metadata: aggregateMetadata,
    briefSchemaVersion: '1',
  };

  return brief;
}
