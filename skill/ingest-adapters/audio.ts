// Stage 0 INGEST adapter — audio (G5 — rich-media synthesis from CureIQ)
//
// Handles ONE local audio file. Transcription is done LOCALLY by the Atelier
// whisper sidecar (mlx-whisper on the Mac Studio) — NO gemini/MCP, no API key.
// This adapter does NOT make the network call itself (Stage 0 is deterministic);
// it copies the audio into source/ and writes a transcription handoff to
// `<lesson-output-dir>/.scratch/vision-handoffs.json` (the sidecar the pipeline
// already reads). The Stage-0 driver (prompts/00-ingest/audio.md) POSTs the file
// to the whisper sidecar and folds the transcript back via recordAudioResult().
//
// Why a handoff (not a direct fetch here): keeps chiron's core free of a
// hardcoded LAN dependency — the endpoint + model live in the handoff and are
// overridable, and the call happens in the driver step like image/video vision.
//
// Stage 0 is deterministic — NO transcription happens here.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { Brief, Domain } from '../lib/schemas/brief.js';
import { copySources, type SourceInput } from '../lib/source-copy.js';
import { stage } from '../lib/progress.js';

const AUDIO_EXTS = new Set<string>([
  '.mp3',
  '.wav',
  '.m4a',
  '.flac',
  '.ogg',
  '.opus',
  '.aac',
  '.wma',
]);

const AUDIO_PENDING_TOKEN = '<PENDING-VISION-HANDOFF>';

// Atelier whisper sidecar (mlx-whisper). LAN-reachable from this host; the
// model alias 'large-v3' is the heaviest/most-accurate (vs 'turbo' default).
// Both overridable via env for portability / a different host.
const WHISPER_ENDPOINT =
  process.env.CHIRON_WHISPER_URL ?? 'http://192.168.0.159:8766';
const WHISPER_MODEL = process.env.CHIRON_WHISPER_MODEL ?? 'large-v3';

// ---------- Transcription handoff (shares the vision-handoffs.json filename) ----------

export interface AudioHandoff {
  /** Absolute path to the COPIED audio under <lesson-output-dir>/source/. */
  source: string;
  transcriber: 'atelier-whisper';
  /** Base URL of the whisper sidecar; POST {endpoint}/transcribe. */
  endpoint: string;
  /** Model alias — 'large-v3' = best accuracy, 'turbo' = fast. */
  model: string;
  /** Whisper sidecar response_format; 'json' returns {text, language, segments}. */
  responseFormat: 'json' | 'text';
}

interface AudioHandoffsSidecar {
  briefPath: string;
  sourceType: 'audio';
  handoffs: AudioHandoff[];
}

function writeAudioHandoffs(scratchDir: string, sidecar: AudioHandoffsSidecar): string {
  mkdirSync(scratchDir, { recursive: true });
  const path = join(scratchDir, 'vision-handoffs.json');
  writeFileSync(path, JSON.stringify(sidecar, null, 2), 'utf8');
  return path;
}

// ---------- Public API ----------

export interface IngestAudioOptions {
  /** A local audio file path. */
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  /** Resolved Chiron domain — caller MUST supply (no classification here). */
  domain: Domain;
}

export async function ingestAudio(opts: IngestAudioOptions): Promise<Brief> {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestAudio: sourcePath does not exist: ${absInput}`);
  }
  if (!statSync(absInput).isFile()) {
    throw new Error(`ingestAudio: sourcePath is not a file: ${absInput}`);
  }
  const ext = extname(absInput).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) {
    throw new Error(
      `ingestAudio: unsupported audio extension '${ext}' for file ${absInput}`,
    );
  }

  stage(0, 5, `ingest: audio (1 file — 1 whisper transcription follows, model=${WHISPER_MODEL})`);

  const lessonDir = resolve(opts.lessonOutputDir);
  const sourceDir = join(lessonDir, 'source');
  const scratchDir = join(lessonDir, '.scratch');
  const briefPath = join(lessonDir, 'brief.json');

  const plan: SourceInput[] = [
    { path: absInput, kind: 'audio', relPath: basename(absInput) },
  ];
  const copied = await copySources(plan, sourceDir);
  const copiedPath = copied[0]!.copiedPath;
  const sourceCopiedTo = copiedPath.startsWith(lessonDir + '/')
    ? join('source', basename(copiedPath))
    : copiedPath;

  writeAudioHandoffs(scratchDir, {
    briefPath,
    sourceType: 'audio',
    handoffs: [
      {
        source: copiedPath,
        transcriber: 'atelier-whisper',
        endpoint: WHISPER_ENDPOINT,
        model: WHISPER_MODEL,
        responseFormat: 'json',
      },
    ],
  });

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType: 'audio',
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText: AUDIO_PENDING_TOKEN,
    metadata: {
      totalSizeBytes: statSync(copiedPath).size,
      format: ext.replace(/^\./, ''),
      whisperModel: WHISPER_MODEL,
      whisperEndpoint: WHISPER_ENDPOINT,
    },
    briefSchemaVersion: '1',
  };

  return brief;
}

// ---------- whisper-transcript fold-in ----------

interface BriefOnDisk {
  extractedText: string;
  metadata: Record<string, unknown> & { transcriptLanguage?: string };
  [k: string]: unknown;
}

/**
 * Fold the whisper transcript into the on-disk brief.json. One handoff per
 * audio file: replaces the `<PENDING-VISION-HANDOFF>` token with the transcript
 * and records the detected language in metadata for traceability.
 */
export function recordAudioResult(
  briefPath: string,
  transcript: string,
  language?: string,
): void {
  const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as BriefOnDisk;
  brief.extractedText = transcript.trim();
  const meta = (brief.metadata ??= {} as BriefOnDisk['metadata']);
  if (language) meta.transcriptLanguage = language;
  writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');
}
