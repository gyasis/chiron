/**
 * Chiron — Audio Lecture bake ("Listen mode"). Runs AFTER Stage 5 assemble,
 * async + non-blocking (the lesson is already usable; audio fills in as clips
 * land). Deterministic — NO LLM / SDK here (Q8-safe): the lecture *script* is
 * authored upstream by Gemini (Stage 04s); this module only synthesizes voice.
 *
 * Per artifact (shortest-first: summary → shortened → section), per language-
 * tagged segment:
 *   OmniVoice POST :8770/tts (lang + routed Lucrezia/pauls_tutor ref)
 *     → `tts-normalize -30`  (hardened loudness, reliable on short clips)
 *     → `tts-splice` (gap policy + equal-power crossfade)
 *     → ffmpeg wav→mp3  → <lesson>/audio/...
 *   → upsert `audio_clips` (script_hash keys reuse; status/error = audit log).
 *
 * Graceful: if Atelier OmniVoice is unreachable, every clip is recorded
 * `pending` (lesson still works) and the bake returns without throwing.
 *
 * Tools required on PATH: tts-normalize, tts-splice (~/.local/bin), ffmpeg/ffprobe.
 * Per CLAUDE.md: no console.log — progress → stderr, errors propagate as status.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

import { progress } from './progress.js';

export type SegLang = 'en' | 'it';

/** One language-tagged span of a lecture script (authored by Gemini, Stage 04s). */
export interface LectureSegment {
  lang: SegLang;
  text: string;
  /** Registered OmniVoice voice name (resolved upstream by domain/language routing). */
  voice: string;
  /** Silence after this segment in ms (0 ⇒ equal-power crossfade into the next). */
  gapAfterMs: number;
  /** Optional DOM anchor this span points at (voice-follow). */
  refAnchor?: string;
  /** Optional per-segment gain dB (e.g. −1.5 to tame a foreign-word pitch reset). */
  gainDb?: number;
}

export type ArtifactKind =
  | 'summary' | 'shortened' | 'section'              // floating-panel lectures
  | 'dialogue' | 'phrase' | 'grammar-pearl'          // inline (anchored to a DOM element)
  | 'story-verbatim' | 'story-description';

/** A bakeable lecture unit. `sectionId` set only for `kind: 'section'`. */
export interface LectureArtifact {
  kind: ArtifactKind;
  sectionId?: string;
  segments: LectureSegment[];
}

/** OmniVoice reference for a registered voice (paths are Mac-side, read by the sidecar). */
export interface VoiceRef {
  refAudio: string;
  refText: string;
  numStep?: number;
}

export interface AudioBakeOptions {
  lessonOutputDir: string;
  courseId: string;
  artifacts: LectureArtifact[];
  /** voice name → its OmniVoice ref. */
  voices: Record<string, VoiceRef>;
  /** default `http://192.168.0.159:8770`. */
  omnivoiceUrl?: string;
  /** target playback LUFS, default −30. */
  playbackTarget?: number;
}

export type ClipStatus = 'done' | 'reused' | 'failed' | 'pending';

export interface AudioClipResult {
  artifact: ArtifactKind;
  sectionId: string;
  status: ClipStatus;
  audioPath?: string;
  error?: string;
}

const STAGE = 'audio-bake';
const DEFAULT_OV = 'http://192.168.0.159:8770';
const DEFAULT_TARGET = -20; // playback LUFS — Gyasi's preference (raised from -30; -30 was too quiet, 2026-06-10)
/** Bake order: shortest/most-useful first so it's playable while the rest run. */
const ORDER: ArtifactKind[] = [
  'summary', 'shortened', 'section',
  'dialogue', 'story-verbatim', 'story-description', 'grammar-pearl', 'phrase',
];

type ClipRow = Record<string, string | number | null>;

function hashSegments(segs: LectureSegment[]): string {
  return createHash('sha256').update(JSON.stringify(segs)).digest('hex').slice(0, 16);
}

function uniqueOr(values: string[], mixed = 'mixed'): string {
  const set = new Set(values);
  return set.size === 1 ? [...set][0]! : mixed;
}

function relAudioPath(kind: ArtifactKind, sectionId: string): string {
  // Anchored kinds (section/dialogue/phrase/grammar-pearl/story-*) → audio/<kind>/<anchor>.mp3.
  // Whole-lesson kinds (summary/shortened) have no anchor → audio/<kind>.mp3.
  return sectionId
    ? join('audio', kind, `${sectionId}.mp3`)
    : join('audio', `${kind}.mp3`);
}

async function omnivoiceReady(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function synthSegment(url: string, seg: LectureSegment, ref: VoiceRef, outWav: string): Promise<void> {
  const body = JSON.stringify({
    text: seg.text,
    ref_audio: ref.refAudio,
    ref_text: ref.refText,
    language: seg.lang,
    num_step: ref.numStep ?? 48,
    guidance_scale: 2.0,
    class_temperature: 0.3,
    // Per-segment pitch shift (semitones) — lets a dialogue give a second speaker
    // a distinct voice from the same clone (e.g. the learner's turns pitched down).
    pitch_semitones: (seg as { pitchSemitones?: number }).pitchSemitones ?? 0,
  });
  const r = await fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) throw new Error(`OmniVoice HTTP ${r.status} for "${seg.text.slice(0, 32)}…"`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error(`OmniVoice returned ${buf.length} bytes (too small) for "${seg.text.slice(0, 32)}…"`);
  writeFileSync(outWav, buf);
}

/**
 * Synthesize with retry. OmniVoice can transiently 500 / time out / refuse the
 * connection if the Atelier sidecar crashes under memory pressure and launchd is
 * mid-restart. Wait out the restart (poll /readyz) and retry, so a hiccup
 * self-recovers instead of failing the clip (and the whole artifact).
 */
async function synthWithRetry(url: string, seg: LectureSegment, ref: VoiceRef, outWav: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await synthSegment(url, seg, ref, outWav);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      progress(STAGE, `  transient (${msg.slice(0, 44)}) — retry ${i + 1}/${attempts - 1}, waiting for OmniVoice…`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));   // backoff
      for (let w = 0; w < 12; w++) {                             // wait out a launchd restart (~36s)
        if (await omnivoiceReady(url)) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

function probeDuration(p: string): number | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf-8' });
    const d = parseFloat(out.trim());
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

/**
 * Write a browser-readable `audio/manifest.json` (the player can't open the
 * SQLite DB). Mirrors the `audio_clips` rows the player needs.
 */
function writeManifest(db: Database.Database, lessonDir: string, courseId: string): void {
  const clips = db
    .prepare(
      `SELECT artifact, section_id AS sectionId, audio_path AS audioPath, status, duration_s AS durationS
         FROM audio_clips WHERE course_id = ? ORDER BY artifact, section_id`,
    )
    .all(courseId);
  const audioDir = join(lessonDir, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const payload = JSON.stringify({ clips });
  // manifest.json for HTTP-served lessons; manifest.js (sets a global) for
  // file:// lessons, where fetch() of a local file is blocked by the browser.
  writeFileSync(join(audioDir, 'manifest.json'), JSON.stringify({ clips }, null, 2));
  writeFileSync(join(audioDir, 'manifest.js'), `window.__chironAudioManifest = ${payload};\n`);
}

function buildRow(
  courseId: string,
  art: LectureArtifact,
  sectionId: string,
  hash: string,
  status: ClipStatus,
  fields: Partial<ClipRow>,
): ClipRow {
  return {
    course_id: courseId,
    artifact: art.kind,
    section_id: sectionId,
    voice: uniqueOr(art.segments.map((s) => s.voice)),
    lang: uniqueOr(art.segments.map((s) => s.lang)),
    script_hash: hash,
    segments_json: JSON.stringify(art.segments),
    audio_path: null,
    duration_s: null,
    bytes: null,
    lufs: null,
    status,
    error: null,
    reuse_count: 0,
    generated_at: Date.now(),
    ...fields,
  };
}

/**
 * Bake all lecture artifacts into sidecar mp3s + the `audio_clips` manifest.
 * Resolves with a per-clip result list; never rejects (failures are per-clip).
 */
export async function bakeAudio(opts: AudioBakeOptions): Promise<AudioClipResult[]> {
  const lessonDir = resolve(opts.lessonOutputDir);
  const url = opts.omnivoiceUrl ?? DEFAULT_OV;
  const target = opts.playbackTarget ?? DEFAULT_TARGET;
  const db = new Database(join(lessonDir, '.chiron-state.db'));
  const results: AudioClipResult[] = [];

  const upsertSql = `
    INSERT INTO audio_clips
      (course_id, artifact, section_id, voice, lang, script_hash, segments_json,
       audio_path, duration_s, bytes, lufs, status, error, reuse_count, generated_at)
    VALUES
      (@course_id, @artifact, @section_id, @voice, @lang, @script_hash, @segments_json,
       @audio_path, @duration_s, @bytes, @lufs, @status, @error, @reuse_count, @generated_at)
    ON CONFLICT(course_id, artifact, section_id) DO UPDATE SET
      voice=excluded.voice, lang=excluded.lang, script_hash=excluded.script_hash,
      segments_json=excluded.segments_json, audio_path=excluded.audio_path,
      duration_s=excluded.duration_s, bytes=excluded.bytes, lufs=excluded.lufs,
      status=excluded.status, error=excluded.error, reuse_count=excluded.reuse_count,
      generated_at=excluded.generated_at`;

  try {
    const upsert = db.prepare(upsertSql);
    const findExisting = db.prepare(
      `SELECT script_hash AS scriptHash, audio_path AS audioPath, reuse_count AS reuseCount
         FROM audio_clips WHERE course_id=? AND artifact=? AND section_id=?`,
    );

    const ordered = [...opts.artifacts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

    if (!(await omnivoiceReady(url))) {
      for (const art of ordered) {
        const sid = art.sectionId ?? '';
        upsert.run(buildRow(opts.courseId, art, sid, hashSegments(art.segments), 'pending', {
          error: `Atelier OmniVoice unreachable at ${url}`,
        }));
        results.push({ artifact: art.kind, sectionId: sid, status: 'pending', error: 'Atelier offline' });
      }
      writeManifest(db, lessonDir, opts.courseId);
      progress(STAGE, `OmniVoice unreachable (${url}) — ${ordered.length} clip(s) pending; lesson works, audio bakes later`);
      return results;
    }

    let baked = 0;
    let reused = 0;
    let failed = 0;

    for (const art of ordered) {
      const sid = art.sectionId ?? '';
      const label = `${art.kind}${sid ? `/${sid}` : ''}`;
      const hash = hashSegments(art.segments);
      const relPath = relAudioPath(art.kind, sid);
      const existing = findExisting.get(opts.courseId, art.kind, sid) as
        | { scriptHash: string; audioPath: string | null; reuseCount: number }
        | undefined;

      // Reuse: same script + file still on disk → don't re-synthesize (economy-first).
      if (existing && existing.scriptHash === hash && existing.audioPath && existsSync(join(lessonDir, existing.audioPath))) {
        upsert.run(buildRow(opts.courseId, art, sid, hash, 'done', {
          audio_path: existing.audioPath,
          reuse_count: existing.reuseCount + 1,
        }));
        results.push({ artifact: art.kind, sectionId: sid, status: 'reused', audioPath: existing.audioPath });
        reused++;
        progress(STAGE, `reused ${label} (script unchanged)`);
        continue;
      }

      const work = join(tmpdir(), `chiron-bake-${opts.courseId}-${art.kind}-${sid || 'x'}-${hash}`);
      try {
        upsert.run(buildRow(opts.courseId, art, sid, hash, 'pending', {})); // mark in-flight
        mkdirSync(work, { recursive: true });

        const manifestLines: string[] = [];
        for (let i = 0; i < art.segments.length; i++) {
          const seg = art.segments[i]!;
          const ref = opts.voices[seg.voice];
          if (!ref) throw new Error(`no voice ref registered for '${seg.voice}'`);
          progress(STAGE, `${label}: segment ${i + 1}/${art.segments.length} [${seg.lang}] synth`, {
            pct: Math.round((i / art.segments.length) * 100),
          });
          const rawWav = join(work, `raw${i}.wav`);
          const segWav = join(work, `seg${i}.wav`);
          await synthWithRetry(url, seg, ref, rawWav);
          execFileSync('tts-normalize', [rawWav, segWav, String(target)], { stdio: 'pipe' });
          const gap = i < art.segments.length - 1 ? seg.gapAfterMs : 0;
          manifestLines.push(`${segWav}|${gap}${seg.gainDb != null ? `|${seg.gainDb}` : ''}`);
        }

        const manifestPath = join(work, 'manifest.txt');
        writeFileSync(manifestPath, `${manifestLines.join('\n')}\n`);
        const splicedWav = join(work, 'spliced.wav');
        execFileSync('tts-splice', [splicedWav, '--manifest', manifestPath], { stdio: 'pipe' });
        const finalWav = join(work, 'final.wav');
        execFileSync('tts-normalize', [splicedWav, finalWav, String(target)], { stdio: 'pipe' });

        const absPath = join(lessonDir, relPath);
        mkdirSync(dirname(absPath), { recursive: true });
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', finalWav, '-codec:a', 'libmp3lame', '-q:a', '4', absPath], { stdio: 'pipe' });

        const dur = probeDuration(absPath);
        upsert.run(buildRow(opts.courseId, art, sid, hash, 'done', {
          audio_path: relPath,
          duration_s: dur,
          bytes: statSync(absPath).size,
          lufs: target,
          reuse_count: existing ? existing.reuseCount : 0,
        }));
        results.push({ artifact: art.kind, sectionId: sid, status: 'done', audioPath: relPath });
        baked++;
        progress(STAGE, `baked ${label} → ${relPath}${dur ? ` (${dur.toFixed(1)}s)` : ''}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        upsert.run(buildRow(opts.courseId, art, sid, hash, 'failed', { error: msg }));
        results.push({ artifact: art.kind, sectionId: sid, status: 'failed', error: msg });
        failed++;
        progress(STAGE, `FAILED ${label}: ${msg}`);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }

    writeManifest(db, lessonDir, opts.courseId);
    progress(STAGE, `done — ${baked} baked, ${reused} reused, ${failed} failed of ${ordered.length}`);
    return results;
  } finally {
    db.close();
  }
}
