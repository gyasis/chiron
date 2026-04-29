// Stage 0 INGEST adapter — image / image-folder (FR-032 c/d)
//
// Handles either a single image file or a directory of page images. Each
// image is structured as a vision handoff for `mcp__gemini-mcp__interpret_image`
// — this adapter does NOT call any MCP tool itself (per Q8: parent agent
// invokes MCP). Handoffs are written to a sidecar JSON in
// `<lesson-output-dir>/.scratch/vision-handoffs.json`; the harness picks them
// up, calls the MCP tool, and folds results back into brief.json via
// `recordVisionResult()`.
//
// Source images are copied into `<lesson-output-dir>/source/` per FR-030.
// For folders, the directory is mirrored under `source/<dirname>/`.
// Files inside a folder are sorted alphabetically — this preserves page order
// when filenames follow a `page-001.png`-style convention.
//
// `Brief.sourceManifest[]` is populated for `image-folder` (FR-034); single
// images use `sourceType: 'image'` and omit the manifest.
//
// Stage 0 is deterministic — NO LLM calls happen here.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { Brief, SourceFileEntry } from '../lib/schemas/brief.js';
import { copySources, type SourceInput } from '../lib/source-copy.js';
import { stage } from '../lib/progress.js';

// Common page-image extensions accepted by interpret_image.
const IMAGE_EXTS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
]);

const VISION_PROMPT =
  'Extract all readable text from this image. Preserve any visible heading ' +
  'structure in markdown. Describe key figures/tables in 1-2 sentences each.';

const VISION_PENDING_TOKEN = '<PENDING-VISION-HANDOFF>';

// ---------- Vision handoff sidecar ----------

export interface VisionHandoff {
  pageNumber: number; // 1-indexed
  imagePath: string; // path to the COPIED image under <lesson-output-dir>/source/
  mcpTool: 'mcp__gemini-mcp__interpret_image';
  prompt: string;
}

interface VisionHandoffsSidecar {
  briefPath: string;
  sourceType: 'image' | 'image-folder';
  handoffs: VisionHandoff[];
}

function writeVisionHandoffs(
  scratchDir: string,
  sidecar: VisionHandoffsSidecar,
): string {
  mkdirSync(scratchDir, { recursive: true });
  const path = join(scratchDir, 'vision-handoffs.json');
  writeFileSync(path, JSON.stringify(sidecar, null, 2), 'utf8');
  return path;
}

// ---------- Folder listing ----------

function listImagesInFolder(dir: string): string[] {
  const entries = readdirSync(dir);
  const images: string[] = [];
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    images.push(abs);
  }
  // Alphabetic sort — preserves natural page order for `page-001.png` etc.
  images.sort((a, b) => {
    const ba = basename(a);
    const bb = basename(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });
  return images;
}

// ---------- Public API ----------

export interface IngestImageOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
}

export async function ingestImage(opts: IngestImageOptions): Promise<Brief> {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestImage: sourcePath does not exist: ${absInput}`);
  }
  const inputStat = statSync(absInput);

  let isFolder: boolean;
  let imageAbsPaths: string[];
  let folderName: string | null = null;

  if (inputStat.isFile()) {
    const ext = extname(absInput).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      throw new Error(
        `ingestImage: unsupported image extension '${ext}' for file ${absInput}`,
      );
    }
    isFolder = false;
    imageAbsPaths = [absInput];
  } else if (inputStat.isDirectory()) {
    isFolder = true;
    folderName = basename(absInput);
    imageAbsPaths = listImagesInFolder(absInput);
    if (imageAbsPaths.length === 0) {
      throw new Error(
        `ingestImage: directory contains no recognized image files: ${absInput}`,
      );
    }
  } else {
    throw new Error(
      `ingestImage: sourcePath is neither a file nor a directory: ${absInput}`,
    );
  }

  const n = imageAbsPaths.length;
  stage(0, 5, `ingest: image (${n} image${n === 1 ? '' : 's'})`);

  const lessonDir = resolve(opts.lessonOutputDir);
  const sourceDir = join(lessonDir, 'source');

  // Build copy plan. For folders we mirror under source/<dirname>/.
  const copyPlan: SourceInput[] = imageAbsPaths.map((p) => {
    const baseName = basename(p);
    const relPath =
      isFolder && folderName !== null ? join(folderName, baseName) : baseName;
    return { path: p, kind: isFolder ? 'image-folder' : 'image', relPath };
  });

  const copied = await copySources(copyPlan, sourceDir);

  // Compute total size from the copied files (authoritative).
  let totalSizeBytes = 0;
  const formats = new Set<string>();
  for (const c of copied) {
    try {
      totalSizeBytes += statSync(c.copiedPath).size;
    } catch {
      // best-effort
    }
    formats.add(extname(c.copiedPath).toLowerCase().replace(/^\./, ''));
  }

  // Build vision handoffs (1-indexed pageNumbers, ordered by alphabetic input).
  const handoffs: VisionHandoff[] = copied.map((c, idx) => ({
    pageNumber: idx + 1,
    imagePath: c.copiedPath,
    mcpTool: 'mcp__gemini-mcp__interpret_image',
    prompt: VISION_PROMPT,
  }));

  // Build sourceManifest only for image-folder (FR-034).
  let sourceManifest: SourceFileEntry[] | undefined;
  if (isFolder) {
    const now = Date.now();
    sourceManifest = copied.map((c) => ({
      // Path relative to the lesson bundle (lessonOutputDir).
      path: c.copiedPath.startsWith(lessonDir + '/')
        ? c.copiedPath.slice(lessonDir.length + 1)
        : c.copiedPath,
      role: 'primary',
      extractor: 'vision-image',
      tokenCount: 0, // populated when vision result arrives
      extractedAt: now,
    }));
  }

  // Persist the handoff sidecar so the harness can drive MCP calls.
  const briefPath = join(lessonDir, 'brief.json');
  const scratchDir = join(lessonDir, '.scratch');
  writeVisionHandoffs(scratchDir, {
    briefPath,
    sourceType: isFolder ? 'image-folder' : 'image',
    handoffs,
  });

  const sourceCopiedTo =
    isFolder && folderName !== null
      ? join('source', folderName)
      : copied.length > 0
        ? join('source', basename(copied[0]!.copiedPath))
        : null;

  const brief: Brief = {
    domain: 'code', // placeholder — domain detection happens in Stage 1
    mode: opts.mode,
    sourceType: isFolder ? 'image-folder' : 'image',
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText: VISION_PENDING_TOKEN,
    ...(sourceManifest ? { sourceManifest } : {}),
    metadata: {
      imageCount: n,
      totalSizeBytes,
      formats: Array.from(formats).sort(),
    },
    briefSchemaVersion: '1',
  };

  return brief;
}

// ---------- Vision-result fold-in ----------

interface BriefOnDisk {
  extractedText: string;
  sourceManifest?: SourceFileEntry[];
  metadata: Record<string, unknown> & {
    visionResults?: Record<string, string>;
  };
  [k: string]: unknown;
}

/**
 * Fold a single vision-MCP result into the on-disk brief.json.
 *
 * Same shape as the pdf.ts adapter sibling (T070): the harness calls this
 * once per handoff after receiving `interpret_image` output. We:
 *   - replace the `<PENDING-VISION-HANDOFF>` token on first call,
 *   - append page text in `=== Page N ===` markers,
 *   - update the matching `sourceManifest[]` entry's `tokenCount` (rough char-based
 *     approximation; a real tokenizer happens later in the pipeline).
 */
export function recordVisionResult(
  briefPath: string,
  pageN: number,
  extractedTextForImage: string,
): void {
  const raw = readFileSync(briefPath, 'utf8');
  const brief = JSON.parse(raw) as BriefOnDisk;

  const pageMarker = `=== Page ${pageN} ===`;
  const pageBlock = `${pageMarker}\n${extractedTextForImage.trim()}\n`;

  const current = brief.extractedText ?? '';
  const cleared = current === VISION_PENDING_TOKEN ? '' : current;
  brief.extractedText = (cleared ? cleared.trimEnd() + '\n\n' : '') + pageBlock;

  // Rough token count = chars / 4 (good enough for provenance; real count later).
  const approxTokens = Math.max(0, Math.round(extractedTextForImage.length / 4));

  if (Array.isArray(brief.sourceManifest) && brief.sourceManifest.length > 0) {
    // For image-folder, manifest is ordered identically to handoffs (1-indexed).
    const idx = pageN - 1;
    if (idx >= 0 && idx < brief.sourceManifest.length) {
      const entry = brief.sourceManifest[idx]!;
      entry.tokenCount = approxTokens;
      entry.extractedAt = Date.now();
    }
  }

  // Mirror per-page result into metadata for traceability.
  const meta = (brief.metadata ??= {} as BriefOnDisk['metadata']);
  meta.visionResults ??= {};
  meta.visionResults[String(pageN)] = extractedTextForImage;

  writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');
}
