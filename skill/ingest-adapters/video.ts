// Stage 0 INGEST adapter — video / YouTube (G5 — rich-media synthesis from CureIQ)
//
// Handles ONE source: a local video file OR a YouTube URL. The source is
// structured as a handoff for `mcp__gemini-mcp__watch_video` — this adapter
// does NOT call any MCP tool itself (per Q8: the parent agent invokes MCP).
// The handoff is written to `<lesson-output-dir>/.scratch/vision-handoffs.json`
// (the same sidecar the pipeline already reads); the harness fulfills it by
// calling watch_video, then folds the transcript + visual analysis back into
// brief.json via `recordVideoResult()`.
//
// `watch_video` handles all transports itself: YouTube URLs are read directly
// (no download), local files <20MB go inline, >20MB use Gemini's File API with
// auto-polling. So this adapter only needs to point at the source.
//
// Local files are copied into `<lesson-output-dir>/source/` (FR-030). YouTube
// URLs are NOT downloaded — only the URL is recorded (sourceCopiedTo = null).
//
// Stage 0 is deterministic — NO LLM calls happen here.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { Brief, Domain } from '../lib/schemas/brief.js';
import { copySources, type SourceInput } from '../lib/source-copy.js';
import { stage } from '../lib/progress.js';

// Container extensions watch_video accepts (Gemini supports common formats).
const VIDEO_EXTS = new Set<string>([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.m4v',
  '.mpeg',
  '.mpg',
]);

const VIDEO_PENDING_TOKEN = '<PENDING-VISION-HANDOFF>';

// Base prompt: transcript + visual + subject. Domain hints are appended by the
// Stage-0 driver prompt (prompts/00-ingest/video.md), mirroring image.ts.
const VIDEO_PROMPT =
  'Transcribe the spoken audio of this video verbatim. Then, section by ' +
  'section, summarize the visual content (slides, diagrams, on-screen text, ' +
  'demonstrations) and note approximate timestamps for major topic shifts. ' +
  'At the end, state the single primary subject/topic of the video in one line ' +
  'prefixed with `SUBJECT:`.';

export function isYouTubeUrl(s: string): boolean {
  return (
    (s.startsWith('http://') || s.startsWith('https://')) &&
    (s.includes('youtube.com') || s.includes('youtu.be'))
  );
}

// ---------- Handoff sidecar (shares the vision-handoffs.json filename) ----------

export interface VideoHandoff {
  /** Local copied path (under source/) or the YouTube URL, verbatim. */
  source: string;
  isYouTube: boolean;
  mcpTool: 'mcp__gemini-mcp__watch_video';
  prompt: string;
}

interface VideoHandoffsSidecar {
  briefPath: string;
  sourceType: 'video';
  handoffs: VideoHandoff[];
}

function writeVideoHandoffs(scratchDir: string, sidecar: VideoHandoffsSidecar): string {
  mkdirSync(scratchDir, { recursive: true });
  const path = join(scratchDir, 'vision-handoffs.json');
  writeFileSync(path, JSON.stringify(sidecar, null, 2), 'utf8');
  return path;
}

// ---------- Public API ----------

export interface IngestVideoOptions {
  /** A local video file path OR a YouTube URL. */
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  /** Resolved Chiron domain — caller MUST supply (no classification here). */
  domain: Domain;
}

export async function ingestVideo(opts: IngestVideoOptions): Promise<Brief> {
  const lessonDir = resolve(opts.lessonOutputDir);
  const scratchDir = join(lessonDir, '.scratch');
  const briefPath = join(lessonDir, 'brief.json');

  const youtube = isYouTubeUrl(opts.sourcePath);

  let handoffSource: string;
  let sourceCopiedTo: string | null;
  const metadata: Record<string, unknown> = {};

  if (youtube) {
    stage(0, 5, 'ingest: video (YouTube — 1 watch_video call follows)');
    handoffSource = opts.sourcePath;
    sourceCopiedTo = null;
    metadata.youtubeUrl = opts.sourcePath;
  } else {
    const absInput = resolve(opts.sourcePath);
    if (!existsSync(absInput)) {
      throw new Error(`ingestVideo: sourcePath does not exist: ${absInput}`);
    }
    if (!statSync(absInput).isFile()) {
      throw new Error(`ingestVideo: sourcePath is not a file: ${absInput}`);
    }
    const ext = extname(absInput).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) {
      throw new Error(
        `ingestVideo: unsupported video extension '${ext}' for file ${absInput}`,
      );
    }
    stage(0, 5, 'ingest: video (local file — 1 watch_video call follows)');

    const sourceDir = join(lessonDir, 'source');
    const plan: SourceInput[] = [
      { path: absInput, kind: 'video', relPath: basename(absInput) },
    ];
    const copied = await copySources(plan, sourceDir);
    const copiedPath = copied[0]!.copiedPath;
    handoffSource = copiedPath;
    sourceCopiedTo = copiedPath.startsWith(lessonDir + '/')
      ? join('source', basename(copiedPath))
      : copiedPath;
    metadata.totalSizeBytes = statSync(copiedPath).size;
    metadata.format = ext.replace(/^\./, '');
  }

  writeVideoHandoffs(scratchDir, {
    briefPath,
    sourceType: 'video',
    handoffs: [
      {
        source: handoffSource,
        isYouTube: youtube,
        mcpTool: 'mcp__gemini-mcp__watch_video',
        prompt: VIDEO_PROMPT,
      },
    ],
  });

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType: 'video',
    sourcePath: opts.sourcePath,
    sourceCopiedTo,
    extractedText: VIDEO_PENDING_TOKEN,
    metadata,
    briefSchemaVersion: '1',
  };

  return brief;
}

// ---------- watch_video result fold-in ----------

interface BriefOnDisk {
  extractedText: string;
  metadata: Record<string, unknown> & { videoResult?: string };
  [k: string]: unknown;
}

/**
 * Fold the watch_video analysis into the on-disk brief.json. One handoff per
 * video, so this is simpler than the image sibling: it replaces the
 * `<PENDING-VISION-HANDOFF>` token with the analysis and mirrors the raw text
 * into `metadata.videoResult` for traceability.
 */
export function recordVideoResult(briefPath: string, analysis: string): void {
  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as BriefOnDisk;
  brief.extractedText = analysis.trim();
  const meta = (brief.metadata ??= {} as BriefOnDisk['metadata']);
  meta.videoResult = analysis;
  writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');
}
