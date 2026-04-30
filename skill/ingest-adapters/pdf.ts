// Stage 0 INGEST adapter — pdf (FR-032 b/c)
//
// Handles single-PDF inputs. Two paths:
//   1. text-PDF — pdfjs-dist extracts a usable text layer. sourceType = 'pdf-text'.
//   2. scanned-PDF — first non-cover page has <=50 chars of text. sourceType =
//      'pdf-scanned'. The adapter does NOT rasterize or call vision itself
//      (per Q8 architecture: vision is a parent-agent callback). Instead it
//      writes a `vision-handoffs.json` sidecar describing per-page work the
//      harness must fulfill via `mcp__gemini-mcp__interpret_image`, and
//      returns a Brief with `extractedText: '<PENDING-VISION-HANDOFF>'`.
//      Once the parent has run each page, it calls `recordVisionResult()`
//      to fold the page text back into the Brief sidecar.
//
// FR-030: source PDF is copied to `<lesson-output-dir>/source/` via
// `copySources()`.
// R-10 replacement: page count is announced up front via `progress.stage()`.
// This file MUST NOT call any LLM/MCP — it only structures handoffs.

import * as fs from 'node:fs';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';

import type { Brief, Domain, SourceType } from '../lib/schemas/brief.js';
import { copySources } from '../lib/source-copy.js';
import { stage as progressStage, chapter as progressChapter } from '../lib/progress.js';

// ---------- Atomic sidecar write helpers ----------

/**
 * Atomic JSON write via temp-file-and-rename. Prevents partial/corrupt
 * sidecar files if the process is killed mid-write.
 */
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Synchronous file-lock pattern using a `.lock` sidecar created with the
 * `wx` flag (exclusive create). Concurrent invocations of
 * `recordVisionResult` for the same brief serialize through this lock.
 */
function withFileLock<T>(lockPath: string, fn: () => T, maxWaitMs = 5000): T {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // best-effort cleanup
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // busy wait briefly before retrying
      const until = Date.now() + 50;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
  throw new Error('Timed out waiting for file lock: ' + lockPath);
}

// Threshold: a non-cover page with <= this many trimmed chars is treated as
// having no usable text layer (i.e. the PDF is scanned).
const TEXT_LAYER_MIN_CHARS = 50;

// ---------- Types ----------

export interface IngestPdfOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  /**
   * Resolved Chiron domain — the caller (trigger-context layer / pipeline
   * orchestrator) MUST supply this. The adapter does NOT classify; it just
   * threads the value into the Brief.
   */
  domain: Domain;
  /** Number of leading pages to skip when judging text-layer availability. Defaults to 1. */
  coverPageCount?: number;
}

/**
 * One per-page handoff the parent agent fulfills by:
 *   1. Rasterizing the page via `pdf-to-img` to `imagePath`.
 *   2. Calling `mcp__gemini-mcp__interpret_image` with `prompt`.
 *   3. Calling `recordVisionResult(briefPath, pageNumber, text)` with the result.
 */
export interface VisionHandoff {
  pageNumber: number;
  imagePath: string;
  mcpTool: 'mcp__gemini-mcp__interpret_image';
  prompt: string;
}

const VISION_PROMPT =
  'Extract all readable text from this PDF page verbatim. ' +
  'Preserve heading structure with markdown #, ##, ###. ' +
  'Note any figures/tables.';

// ---------- pdfjs-dist loading ----------

// pdfjs-dist exposes two builds; the legacy build runs cleanly under Node.
// We dynamic-import to avoid forcing the dependency on consumers that don't
// hit the PDF adapter.
interface PdfjsTextItem {
  str?: string;
}
interface PdfjsTextContent {
  items: PdfjsTextItem[];
}
interface PdfjsPage {
  getTextContent(): Promise<PdfjsTextContent>;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}
interface PdfjsLib {
  getDocument(args: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
}

async function loadPdfjs(): Promise<PdfjsLib> {
  // Legacy build is the Node-friendly entry point.
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLib;
  return mod;
}

async function extractPageTexts(absPdf: string): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const data = readFileSync(absPdf);
  // pdfjs requires a Uint8Array view, not a Node Buffer alias.
  const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const doc = await pdfjs.getDocument({ data: u8 }).promise;

  const total = doc.numPages;
  const out: string[] = [];
  for (let i = 1; i <= total; i++) {
    progressChapter(0, i, total, `page ${i}`);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => it.str ?? '').join(' ');
    out.push(text);
  }
  return out;
}

// ---------- Public API ----------

export async function ingestPdf(opts: IngestPdfOptions): Promise<Brief> {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestPdf: sourcePath does not exist: ${absInput}`);
  }
  const st = statSync(absInput);
  if (!st.isFile()) {
    throw new Error(`ingestPdf: sourcePath is not a file: ${absInput}`);
  }

  // Probe page count first so the up-front announcement is accurate.
  const pageTextLayers = await extractPageTexts(absInput);
  const pageCount = pageTextLayers.length;

  progressStage(0, 5, `ingest: pdf (${pageCount} pages)`);

  // Cover-page heuristic.
  const coverPagesSkipped = Math.max(0, opts.coverPageCount ?? 1);
  const probeIndex = Math.min(coverPagesSkipped, Math.max(0, pageCount - 1));
  const firstNonCoverText = (pageTextLayers[probeIndex] ?? '').trim();
  const hasTextLayer =
    pageCount > 0 && firstNonCoverText.length > TEXT_LAYER_MIN_CHARS;

  // FR-030: copy the source PDF into <lesson-output-dir>/source/.
  const destSourceDir = join(resolve(opts.lessonOutputDir), 'source');
  const copied = await copySources(
    [{ path: absInput, kind: 'pdf' }],
    destSourceDir,
  );
  const sourceCopiedTo = copied[0]?.copiedPath ?? null;

  const sourceType: SourceType = hasTextLayer ? 'pdf-text' : 'pdf-scanned';

  // ---------- Text path ----------
  if (hasTextLayer) {
    const chunks: string[] = [];
    for (let i = 0; i < pageCount; i++) {
      const body = (pageTextLayers[i] ?? '').trim();
      chunks.push(`[Page ${i + 1} of ${pageCount}]\n${body}`);
    }
    const extractedText = chunks.join('\n\n');

    const brief: Brief = {
      domain: opts.domain,
      mode: opts.mode,
      sourceType,
      sourcePath: absInput,
      sourceCopiedTo,
      extractedText,
      metadata: {
        pageCount,
        hasTextLayer: true,
        coverPagesSkipped,
        primaryLanguage: null,
      },
      briefSchemaVersion: '1',
    };
    return brief;
  }

  // ---------- Scanned path ----------
  // Build per-page vision handoffs and write the sidecar. Adapter does NOT
  // rasterize or invoke MCP. Parent agent fulfills each handoff and folds
  // results back via recordVisionResult().
  const scratchDir = join(resolve(opts.lessonOutputDir), '.scratch');
  mkdirSync(scratchDir, { recursive: true });

  const visionHandoffs: VisionHandoff[] = [];
  for (let i = 1; i <= pageCount; i++) {
    visionHandoffs.push({
      pageNumber: i,
      imagePath: join(scratchDir, `page-${i}.png`),
      mcpTool: 'mcp__gemini-mcp__interpret_image',
      prompt: VISION_PROMPT,
    });
  }

  const handoffsPath = join(scratchDir, 'vision-handoffs.json');
  atomicWriteJson(handoffsPath, {
    sourcePdf: absInput,
    pageCount,
    coverPagesSkipped,
    handoffs: visionHandoffs,
    // Per-page results are filled by recordVisionResult().
    results: {} as Record<string, string>,
  });

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType,
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText: '<PENDING-VISION-HANDOFF>',
    metadata: {
      pageCount,
      hasTextLayer: false,
      coverPagesSkipped,
      primaryLanguage: null,
      visionHandoffs,
      visionHandoffsPath: handoffsPath,
    },
    briefSchemaVersion: '1',
  };
  return brief;
}

/**
 * Fold a single page's vision-extracted text back into the Brief sidecar.
 *
 * `briefPath` is the on-disk path to the Brief JSON. The function:
 *   1. Reads the brief and the companion `vision-handoffs.json`.
 *   2. Records the page text under `results[pageN]`.
 *   3. If every page now has a result, replaces `extractedText` with the
 *      ordered concatenation `[Page N of M]\n<text>` and clears the
 *      `<PENDING-VISION-HANDOFF>` sentinel.
 *
 * Synchronous to match the simple sidecar-update contract used by the harness.
 */
export function recordVisionResult(
  briefPath: string,
  pageN: number,
  extractedTextForPage: string,
): void {
  const absBrief = resolve(briefPath);
  if (!existsSync(absBrief)) {
    throw new Error(`recordVisionResult: brief not found: ${absBrief}`);
  }

  // Serialize concurrent vision-result folds for the same brief. The lock
  // sidecar lives next to the brief and is removed on release.
  withFileLock(absBrief + '.lock', () => {
    const brief = JSON.parse(readFileSync(absBrief, 'utf8')) as Brief;

    const meta = brief.metadata as Record<string, unknown>;
    const handoffsPath = meta['visionHandoffsPath'];
    if (typeof handoffsPath !== 'string' || !existsSync(handoffsPath)) {
      throw new Error(
        `recordVisionResult: vision-handoffs.json missing for ${absBrief}`,
      );
    }

    const sidecar = JSON.parse(readFileSync(handoffsPath, 'utf8')) as {
      sourcePdf: string;
      pageCount: number;
      coverPagesSkipped: number;
      handoffs: VisionHandoff[];
      results: Record<string, string>;
    };

    if (pageN < 1 || pageN > sidecar.pageCount) {
      throw new Error(
        `recordVisionResult: pageN ${pageN} out of range 1..${sidecar.pageCount}`,
      );
    }

    sidecar.results[String(pageN)] = extractedTextForPage;
    atomicWriteJson(handoffsPath, sidecar);

    // If every page is filled, materialize the full extractedText.
    const filled = Object.keys(sidecar.results).length;
    if (filled === sidecar.pageCount) {
      const chunks: string[] = [];
      for (let i = 1; i <= sidecar.pageCount; i++) {
        const body = (sidecar.results[String(i)] ?? '').trim();
        chunks.push(`[Page ${i} of ${sidecar.pageCount}]\n${body}`);
      }
      brief.extractedText = chunks.join('\n\n');
      atomicWriteJson(absBrief, brief);
    }
  });
}
