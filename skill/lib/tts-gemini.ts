// Gemini TTS handoff per FR-036 / R-01; Q8 architecture — parent agent invokes MCP, this module structures and persists.
import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { progress } from './progress.js';
import { safeJoin, sanitizeComponent } from './path-safety.js';

/**
 * Handoff describing a TTS synthesis call for the parent Claude Code agent to invoke.
 *
 * The parent agent reads this object, calls the corresponding Gemini MCP tool, and then
 * passes the resulting base64 audio bytes to `recordTtsResult` for persistence.
 *
 * TODO(MCP-tool-name): The exact MCP tool identifier for Gemini TTS synthesis should be
 * confirmed against the live `gemini-mcp` server tool list. The placeholder
 * `mcp__gemini-mcp__tts_synthesize_or_equivalent` is used here; at runtime the parent agent
 * should resolve this to the actual tool (e.g. a future `mcp__gemini-mcp__tts_synthesize`
 * or whatever the Gemini MCP server exposes for speech synthesis).
 */
export interface TtsGeminiHandoff {
  method: 'mcp__gemini-mcp__tts_synthesize_or_equivalent';
  text: string;
  voice: string;
  outputPath: string;
  chapterId: string;
  lineId: string;
}

/** Default voice for Italian native-speaker persona (FR-036 / R-01). */
export const DEFAULT_ITALIAN_VOICE = 'it-female-1';

export interface PrepareTtsHandoffsOpts {
  audioWidgets: Array<{
    chapterId: string;
    lineId: string;
    text: string;
    voice?: string;
  }>;
  lessonOutputDir: string;
}

/**
 * For each audio-tts widget, compute the on-disk output path and emit a handoff.
 * Idempotent: skips widgets whose target mp3 already exists and is non-empty.
 */
export function prepareTtsHandoffs(opts: PrepareTtsHandoffsOpts): TtsGeminiHandoff[] {
  const { audioWidgets, lessonOutputDir } = opts;
  const handoffs: TtsGeminiHandoff[] = [];
  let skipped = 0;

  for (const widget of audioWidgets) {
    // T150: sanitize+safeJoin prevents path traversal via LLM-generated chapter/line ids.
    const safeChapterId = sanitizeComponent(widget.chapterId);
    const safeLineId = sanitizeComponent(widget.lineId);
    const outputPath = safeJoin(
      lessonOutputDir,
      'audio',
      safeChapterId,
      `${safeLineId}.mp3`,
    );

    // Ensure directory exists before the parent agent attempts to write the audio.
    mkdirSync(dirname(outputPath), { recursive: true });

    // Idempotency: skip if a non-empty mp3 already exists.
    if (existsSync(outputPath)) {
      try {
        const stat = statSync(outputPath);
        if (stat.isFile() && stat.size > 0) {
          skipped++;
          continue;
        }
      } catch {
        // Fall through and re-emit handoff on stat failure.
      }
    }

    handoffs.push({
      method: 'mcp__gemini-mcp__tts_synthesize_or_equivalent',
      text: widget.text,
      voice: widget.voice ?? DEFAULT_ITALIAN_VOICE,
      outputPath,
      chapterId: widget.chapterId,
      lineId: widget.lineId,
    });
  }

  progress(
    'tts-gemini',
    `prepared ${handoffs.length} handoff(s); skipped ${skipped} existing file(s)`,
  );
  return handoffs;
}

export interface RecordTtsResultOpts {
  handoff: TtsGeminiHandoff;
  audioBytesBase64: string;
}

/**
 * Decode base64 mp3 bytes returned by the parent agent's MCP call and persist them
 * to the handoff's outputPath. Creates parent directories defensively.
 */
export function recordTtsResult(opts: RecordTtsResultOpts): void {
  const { handoff, audioBytesBase64 } = opts;
  if (!audioBytesBase64 || audioBytesBase64.length === 0) {
    throw new Error(
      `recordTtsResult: empty audioBytesBase64 for ${handoff.chapterId}/${handoff.lineId}`,
    );
  }

  const buf = Buffer.from(audioBytesBase64, 'base64');
  if (buf.length === 0) {
    throw new Error(
      `recordTtsResult: base64 decoded to 0 bytes for ${handoff.chapterId}/${handoff.lineId}`,
    );
  }

  mkdirSync(dirname(handoff.outputPath), { recursive: true });
  writeFileSync(handoff.outputPath, buf);
  progress('tts-gemini', `wrote ${buf.length} byte(s) -> ${handoff.outputPath}`);
}

/**
 * Plan describing how an ElevenLabs fallback would be invoked. Exported for v1 typing
 * stability; not wired into the pipeline.
 */
export interface ElevenLabsFallbackPlan {
  reason: string;
  recommendedVoice: string;
}

/**
 * Stub for ElevenLabs fallback. v1 defers any wiring until the Phase 4 ear-test
 * confirms whether Gemini TTS quality is sufficient (see PRD R-01).
 */
export function generateFallbackPlan(): ElevenLabsFallbackPlan {
  return {
    reason:
      'ElevenLabs fallback not wired in v1. Defer to Phase 4 ear-test result before enabling.',
    recommendedVoice: 'it-female-1',
  };
}
