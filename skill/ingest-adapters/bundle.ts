/**
 * Chiron — bundle ingest adapter (T076, FR-032 l).
 *
 * Walks a directory and dispatches each recognized file to its per-extension
 * adapter (`pdf.ts`, `image.ts`, `url.ts`, `transcript.ts`, `agent-report.ts`,
 * `vocab-list.ts`). The user MAY provide a top-level `chiron.manifest.json`
 * declaring file order + per-file `role`; otherwise files are walked
 * non-recursively, sorted alphabetically, and roles are inferred from
 * filename heuristics.
 *
 * Aggregation rules:
 *  - `extractedText` — ordered concatenation of every delegate's text,
 *    each prefixed by `=== File N: <relpath> [role: X] ===\n`.
 *  - `sourceManifest[]` — every per-file `SourceFileEntry` from delegates is
 *    aggregated; entries are tagged with the bundle-level role (manifest or
 *    heuristic). If a delegate did not emit a manifest, a single derived
 *    entry is synthesized from its Brief.
 *  - `agentSourceProvenance` — set if ANY sub-Brief was an agent-report.
 *
 * FR-035 enforcement: medicine + agent-report-only bundles are refused
 * (matches the same rule `agent-report.ts` enforces for single-source).
 *
 * Unknown extensions are SKIPPED with a `console.warn(...)`, never fatal.
 *
 * This adapter does not call any MCP / LLM directly. Sub-adapters may scaffold
 * vision handoffs via the Stage 0 sidecar pattern (see `pdf.ts` / `image.ts`).
 */

import { existsSync, statSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';

import { safeJoin, PathTraversalError } from '../lib/path-safety.js';
import type {
  Brief,
  Domain,
  Mode,
  SourceFileEntry,
} from '../lib/schemas/brief.js';
import { stage as progressStage, chapter as progressChapter } from '../lib/progress.js';

import { ingestPdf } from './pdf.js';
import { ingestImage } from './image.js';
import { ingestUrl } from './url.js';
import { ingestTranscript } from './transcript.js';
import { ingestAgentReport } from './agent-report.js';
import { ingestVocabList } from './vocab-list.js';

// ---------- Types ----------

export type BundleRole = SourceFileEntry['role'];

export interface BundleManifestEntry {
  path: string;
  role: BundleRole;
}

export interface BundleManifest {
  files: BundleManifestEntry[];
}

export interface IngestBundleOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: Mode;
  domain: Domain;
}

interface ResolvedFile {
  absPath: string;
  relPath: string;
  role: BundleRole;
}

// ---------- Manifest + heuristics ----------

const MANIFEST_FILENAME = 'chiron.manifest.json';

function loadManifest(rootDir: string): BundleManifest | null {
  const p = join(rootDir, MANIFEST_FILENAME);
  if (!existsSync(p)) return null;
  let raw: string;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    throw new Error(
      `ingestBundle: failed to read ${MANIFEST_FILENAME}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `ingestBundle: ${MANIFEST_FILENAME} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error(
      `ingestBundle: ${MANIFEST_FILENAME} must have shape { files: [{path, role}, ...] }`,
    );
  }
  const files = (parsed as { files: unknown[] }).files.map((entry, i) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as { path?: unknown }).path !== 'string' ||
      typeof (entry as { role?: unknown }).role !== 'string'
    ) {
      throw new Error(
        `ingestBundle: ${MANIFEST_FILENAME}.files[${i}] must have string path + role`,
      );
    }
    const role = (entry as { role: string }).role as BundleRole;
    const allowed: BundleRole[] = [
      'primary',
      'supplement',
      'figure',
      'appendix',
      'agent-report',
    ];
    if (!allowed.includes(role)) {
      throw new Error(
        `ingestBundle: ${MANIFEST_FILENAME}.files[${i}].role '${role}' invalid; allowed: ${allowed.join(', ')}`,
      );
    }
    return { path: (entry as { path: string }).path, role };
  });
  return { files };
}

function inferRole(filename: string): BundleRole {
  const base = basename(filename).toLowerCase();
  const stem = base.replace(/\.[^.]+$/, '');
  if (stem === 'readme' || stem === 'main' || stem.startsWith('main.')) {
    return 'primary';
  }
  if (stem.startsWith('agent-') || stem.startsWith('agent_')) {
    return 'agent-report';
  }
  if (stem.startsWith('fig-') || stem.startsWith('figure-') || stem.startsWith('fig_') || stem.startsWith('figure_')) {
    return 'figure';
  }
  if (stem.startsWith('appendix-') || stem.startsWith('appendix_') || stem === 'appendix') {
    return 'appendix';
  }
  return 'supplement';
}

function listTopLevelFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name === MANIFEST_FILENAME) continue;
    files.push(e.name);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

// ---------- Dispatch ----------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

interface DispatchResult {
  /** May be null if the file was skipped (unknown ext / domain mismatch). */
  brief: Brief | null;
  /** True iff the delegate was the agent-report adapter. */
  isAgentReport: boolean;
  /** Reason for skipping (when brief is null). */
  skipReason?: string;
}

async function dispatchOne(
  file: ResolvedFile,
  scratchSubDir: string,
  opts: IngestBundleOptions,
): Promise<DispatchResult> {
  const ext = extname(file.absPath).toLowerCase();
  // Each sub-delegate gets its own lessonOutputDir so source-copy + scratch
  // don't collide between files in the bundle.
  mkdirSync(scratchSubDir, { recursive: true });

  const sub = {
    sourcePath: file.absPath,
    lessonOutputDir: scratchSubDir,
    mode: opts.mode,
    domain: opts.domain,
  };

  if (ext === '.pdf') {
    return { brief: await ingestPdf(sub), isAgentReport: false };
  }
  if (IMAGE_EXTS.has(ext)) {
    return { brief: await ingestImage(sub), isAgentReport: false };
  }
  if (ext === '.html' || ext === '.htm') {
    return { brief: await ingestUrl(sub), isAgentReport: false };
  }
  if (ext === '.txt') {
    return { brief: await ingestTranscript(sub), isAgentReport: false };
  }
  if (ext === '.md') {
    if (file.role === 'agent-report') {
      return { brief: await ingestAgentReport(sub), isAgentReport: true };
    }
    return { brief: await ingestTranscript(sub), isAgentReport: false };
  }
  if (ext === '.json') {
    return { brief: await ingestAgentReport(sub), isAgentReport: true };
  }
  if (ext === '.csv') {
    if (opts.domain !== 'language-it') {
      const reason = `csv only supported for language-it domain (got ${opts.domain})`;
      console.warn(`Skipping unsupported csv in bundle: ${file.relPath} (${reason})`);
      return { brief: null, isAgentReport: false, skipReason: reason };
    }
    // vocab-list signature predates the universal Brief opts; pass through.
    return {
      brief: ingestVocabList({
        sourcePath: file.absPath,
        lessonOutputDir: scratchSubDir,
        mode: opts.mode,
      }),
      isAgentReport: false,
    };
  }

  console.warn(`Skipping unknown file in bundle: ${file.relPath}`);
  return { brief: null, isAgentReport: false, skipReason: `unknown extension '${ext}'` };
}

// ---------- Manifest synthesis fallback ----------

function inferExtractor(ext: string, isAgentReport: boolean): SourceFileEntry['extractor'] {
  if (isAgentReport) return 'agent-report';
  if (ext === '.pdf') return 'text-pdf';
  if (IMAGE_EXTS.has(ext)) return 'vision-image';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'transcript';
}

// ---------- Public API ----------

export async function ingestBundle(opts: IngestBundleOptions): Promise<Brief> {
  const absRoot = resolve(opts.sourcePath);
  if (!existsSync(absRoot)) {
    throw new Error(`ingestBundle: sourcePath does not exist: ${absRoot}`);
  }
  const rootStat = statSync(absRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`ingestBundle: sourcePath is not a directory: ${absRoot}`);
  }

  const manifest = loadManifest(absRoot);
  const manifestPresent = manifest !== null;

  // Build the ordered list of (absPath, relPath, role) entries.
  // T147: safeJoin prevents path-traversal in manifest entries.
  const files: ResolvedFile[] = [];
  if (manifest) {
    for (let i = 0; i < manifest.files.length; i++) {
      const entry = manifest.files[i]!;
      let absPath: string;
      try {
        absPath = safeJoin(absRoot, entry.path);
      } catch (err) {
        if (err instanceof PathTraversalError) {
          console.warn('Skipping out-of-bundle manifest entry: ' + entry.path);
          continue;
        }
        throw err;
      }
      if (!existsSync(absPath) || !statSync(absPath).isFile()) {
        throw new Error(
          `ingestBundle: ${MANIFEST_FILENAME} references missing file: ${entry.path}`,
        );
      }
      files.push({
        absPath,
        relPath: relative(absRoot, absPath) || entry.path,
        role: entry.role,
      });
    }
  } else {
    const names = listTopLevelFiles(absRoot);
    for (const name of names) {
      let absPath: string;
      try {
        absPath = safeJoin(absRoot, name);
      } catch (err) {
        if (err instanceof PathTraversalError) {
          console.warn('Skipping out-of-bundle manifest entry: ' + name);
          continue;
        }
        throw err;
      }
      files.push({ absPath, relPath: name, role: inferRole(name) });
    }
  }

  if (files.length === 0) {
    throw new Error(
      `ingestBundle: no files to ingest in ${absRoot}` +
        (manifestPresent ? ' (manifest empty)' : ' (directory empty)'),
    );
  }

  progressStage(0, 5, `ingest: bundle (${files.length} files)`);

  // Scratch root for per-file delegate output dirs.
  const scratchRoot = join(resolve(opts.lessonOutputDir), '.scratch');
  mkdirSync(scratchRoot, { recursive: true });

  const aggregateText: string[] = [];
  const aggregateManifest: SourceFileEntry[] = [];
  let anyAgentReport = false;
  let skippedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    progressChapter(0, i + 1, files.length, basename(f.relPath));

    const subDir = join(scratchRoot, `file-${i + 1}`);
    let result: DispatchResult;
    try {
      result = await dispatchOne(f, subDir, opts);
    } catch (err) {
      throw new Error(
        `ingestBundle: failed on file '${f.relPath}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (result.brief === null) {
      skippedCount++;
      continue;
    }

    if (result.isAgentReport) anyAgentReport = true;

    const header = `=== File ${i + 1}: ${f.relPath} [role: ${f.role}] ===`;
    aggregateText.push(`${header}\n${result.brief.extractedText}`);

    // Per-file provenance: prefer delegate's manifest; else synthesize one
    // entry from the sub-Brief and tag it with the bundle-level role.
    const subEntries = result.brief.sourceManifest;
    if (subEntries && subEntries.length > 0) {
      for (const entry of subEntries) {
        aggregateManifest.push({ ...entry, role: f.role });
      }
    } else {
      const ext = extname(f.absPath).toLowerCase();
      aggregateManifest.push({
        path: f.absPath,
        role: f.role,
        extractor: inferExtractor(ext, result.isAgentReport),
        tokenCount: Math.ceil(result.brief.extractedText.length / 4),
        extractedAt: Date.now(),
      });
    }
  }

  // FR-035 / SC-016: medicine forbids agent-report-only bundles.
  if (
    opts.domain === 'medicine' &&
    aggregateManifest.length > 0 &&
    aggregateManifest.every((e) => e.role === 'agent-report')
  ) {
    throw new Error(
      'ingestBundle: medicine domain forbids bundles whose only sources are agent reports (FR-035 / SC-016). Add at least one primary clinical source (PDF, transcript, image).',
    );
  }

  // Pick a representative agentSourceProvenance string when present.
  const agentSourceProvenance = anyAgentReport
    ? `bundle:${absRoot} (one or more agent-report sub-sources)`
    : null;

  const extractedText = aggregateText.join('\n\n');

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType: 'bundle',
    sourcePath: absRoot,
    sourceCopiedTo: null,
    extractedText,
    sourceManifest: aggregateManifest,
    agentSourceProvenance,
    metadata: {
      fileCount: files.length,
      skippedCount,
      manifestPresent,
    },
    briefSchemaVersion: '1',
  };
  return brief;
}
