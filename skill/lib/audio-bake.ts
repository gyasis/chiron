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

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

import { progress } from './progress.js';
import { qcAudioClip, qcAvailable } from './audio-qc.js';

const execFileAsync = promisify(execFile);
/** Bounded-concurrency async map — preserves order, runs at most `limit` tasks at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
  }));
  return out;
}

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

/** Synthesis engine for an artifact — OmniVoice (default) or the Dia sidecar. */
export type SynthEngine = 'omni' | 'dia' | 'modal';

/** A bakeable lecture unit. `sectionId` set only for `kind: 'section'`. */
export interface LectureArtifact {
  kind: ArtifactKind;
  sectionId?: string;
  segments: LectureSegment[];
  /** Which sidecar synthesizes this artifact's segments (default: 'omni'). */
  engine?: SynthEngine;
  /** Dia speaker tag (S1/S2/S3) — required form is `[S1] text`. */
  speaker?: string;
  /** Dia playback speed (<1.0 = slower, pitch-preserved). Also drives the OmniVoice fallback atempo. */
  speed?: number;
  /** Dia emotion hint ∈ {neutral,calm,measured,warm,expressive}. */
  emotion?: string;
  /** On Dia failure: 'omni' (default) falls back to OmniVoice; 'none' lets the clip fail. */
  fallback?: 'omni' | 'none';
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
  /** Dia sidecar base URL; default `http://192.168.0.159:8769`. */
  diaUrl?: string;
  /** target playback LUFS, default −30. */
  playbackTarget?: number;
  /**
   * Enable Gemini audio QC after each clip is written.
   * Default: true when GEMINI_API_KEY or GOOGLE_API_KEY is set AND
   *          CHIRON_AUDIO_QC env var is not "0".
   * Pass false to force-disable regardless of env.
   */
  qc?: boolean;
  /**
   * Optional map of sectionId → the DISPLAYED on-page text that this section's
   * AUDIO must faithfully voice (single-sourced upstream, e.g. audio-intro.json).
   * When present for a `section` artifact, the bake runs a deterministic
   * audio-vs-display divergence check (no model) and writes a `type:"divergence"`
   * defect to qc-report.json when the narration does not correspond to the screen.
   * Sections NOT in this map are allowed to be supplementary (04s teach-don't-read).
   */
  displayedText?: Record<string, string>;
  /**
   * Synthesis backend. 'mac' (default) = today's OmniVoice sidecar, one clip at a time — UNCHANGED.
   * 'modal' = fan the whole lesson's SYNTH out to the Modal L4 lane (bucketed CUDA) up front, then
   * every downstream step (normalize / manifest / splice / mp3 / status / QC) runs LOCALLY exactly as
   * for a Mac bake → byte-identical output, only faster. Any Modal failure falls back to the Mac
   * sidecar per-segment, so 'modal' can never produce a worse result than 'mac'.
   */
  engine?: 'mac' | 'modal';
  /** Absolute path to modal_synth.py — required when engine='modal' (else it falls back to Mac). */
  modalSynthScript?: string;
}

export type ClipStatus = 'done' | 'reused' | 'failed' | 'pending';

export interface AudioClipResult {
  artifact: ArtifactKind;
  sectionId: string;
  status: ClipStatus;
  audioPath?: string;
  error?: string;
  /** Defects reported by Gemini QC after the final take (only set when defects remain). */
  qcDefects?: string[];
}

const STAGE = 'audio-bake';
const DEFAULT_OV = 'http://192.168.0.159:8770';
const DEFAULT_DIA = 'http://192.168.0.159:8769';
const DEFAULT_TARGET = -16; // playback LUFS — Gyasi's preference (−30→−20 2026-06-10, →−16 2026-07-05: −20 still too quiet, −16 = podcast/audiobook loudness)
/** Bake order: shortest/most-useful first so it's playable while the rest run. */
const ORDER: ArtifactKind[] = [
  'summary', 'shortened', 'section',
  'dialogue', 'story-verbatim', 'story-description', 'grammar-pearl', 'phrase',
];

/**
 * Returns the audio-control label used as the key in qc-report.json.
 * Matches the label text shown in the player (.lbl element inside .chiron-listen-btn).
 * Floating-panel kinds: summary→"Summary", shortened→"Full lecture".
 * Anchored kinds (section, dialogue, phrase, etc.): use the sectionId.
 */
function panelLabel(kind: ArtifactKind, sectionId: string): string {
  if (kind === 'summary') return 'Summary';
  if (kind === 'shortened') return 'Full lecture';
  if (kind === 'section') return sectionId || kind;
  return sectionId || kind;
}

/** Parse a leading "m:ss" timestamp from a defect string, best-effort. */
function parseDefectTime(defect: string): string {
  const m = /^(\d+:\d{2})\b/.exec(defect);
  return m ? m[1]! : '';
}

/** Infer a defect type from keywords in the string. */
function inferDefectType(defect: string): string {
  const d = defect.toLowerCase();
  if (d.includes('cut') || d.includes('truncat')) return 'truncation';
  if (d.includes('static') || d.includes('noise') || d.includes('glitch')) return 'static';
  if (d.includes('garbl') || d.includes('muffled') || d.includes('unclear')) return 'garbled';
  if (d.includes('missing') || d.includes('skip')) return 'missing-word';
  return 'defect';
}

interface QcDefectEntry { time: string; type: string; detail: string; }
interface QcReportEntry { status: string; defects: QcDefectEntry[]; }

/** Min fraction of the displayed section's content-words that must appear in the
 *  spoken audio script for the two to be considered "corresponding". Below this
 *  the audio has been rewritten away from the screen (the overview divergence). */
const DIVERGENCE_MIN_CONTAINMENT = 0.6;

/** Content-word set: lowercased alphanumeric tokens of length > 2 (drops articles/prepositions/punct). */
function contentWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2));
}

/** Fraction of the DISPLAYED content-words that also appear in the AUDIO script (1 ⇒ audio covers the screen). */
function displayContainment(audioText: string, displayedText: string): number {
  const audio = contentWords(audioText);
  const shown = contentWords(displayedText);
  if (shown.size === 0) return 1;
  let hit = 0;
  for (const w of shown) if (audio.has(w)) hit++;
  return hit / shown.size;
}

/**
 * Write (or merge) audio/qc-report.json so it always reflects the CURRENT
 * bake run. For every label in `checked`:
 *   - if it has surviving defects → upsert the entry (status: needs-review).
 *   - if it came back clean      → delete any stale entry for that label.
 * Labels not touched this bake run are left unchanged (they may be from a
 * separate run that produced a different artifact set).
 * The report file is removed entirely once all entries are gone.
 */
function mergeQcReport(
  lessonDir: string,
  entries: Map<string, QcDefectEntry[]>,
  checked: Set<string>,
): void {
  if (checked.size === 0) return;

  const reportPath = join(lessonDir, 'audio', 'qc-report.json');
  let existing: Record<string, QcReportEntry> = {};
  try {
    existing = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, QcReportEntry>;
  } catch { /* no prior report */ }

  for (const label of checked) {
    const defects = entries.get(label);
    if (defects && defects.length > 0) {
      existing[label] = { status: 'needs-review', defects };
    } else {
      delete existing[label];
    }
  }

  if (Object.keys(existing).length === 0) {
    try { rmSync(reportPath); } catch { /* already gone */ }
    return;
  }
  writeFileSync(reportPath, JSON.stringify(existing, null, 2));
}

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

async function diaReady(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Dia synth params for a section's slow reading. */
interface DiaParams { speaker: string; speed: number; emotion: string; }

/**
 * Synthesize ONE segment via the Dia sidecar (different cloned voice, with
 * speed + emotion). Dia does its OWN server-side voice cloning (S1/S2/S3 refs),
 * so we send ONLY the `[speaker]` tag + text — never ref_audio/ref_text. The
 * leading `[Sn]` tag is mandatory: with no tag Dia prepends all clone refs →
 * bloat → timeout. Dia idle-unloads, so the first call cold-loads (~10–30s);
 * we pre-check /readyz and use a long per-request timeout.
 */
async function synthDiaSegment(diaUrl: string, seg: LectureSegment, params: DiaParams, outWav: string): Promise<void> {
  if (!(await diaReady(diaUrl))) throw new Error(`Dia sidecar not ready at ${diaUrl}/readyz`);
  const body = JSON.stringify({
    text: `[${params.speaker}] ${seg.text}`,
    speed: params.speed,
    emotion: params.emotion,
    use_voice_clone: true,
    max_new_tokens: 2048,
  });
  const r = await fetch(`${diaUrl}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Dia HTTP ${r.status} for "${seg.text.slice(0, 32)}…"`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error(`Dia returned ${buf.length} bytes (too small) for "${seg.text.slice(0, 32)}…"`);
  writeFileSync(outWav, buf);
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
         FROM audio_clips WHERE course_id = ?`,
    )
    .all(courseId) as Array<{ artifact: string; sectionId: string | null }>;
  // Order by CHAPTER sequence (from syllabus.json), NOT alphabetically by section slug — the old
  // `ORDER BY section_id` sorted the Listen widgets alphabetically, so they played out of order.
  // Whole-lesson kinds (summary/shortened/overview) sort first; sections follow in chapter order.
  const chapterOrder: Record<string, number> = {};
  try {
    const raw = JSON.parse(readFileSync(join(lessonDir, 'syllabus.json'), 'utf8'));
    const chs: any[] = Array.isArray(raw) ? raw : (raw.chapters || raw.syllabus || []);
    chs.forEach((c: any, i: number) => {
      const id = c.chapterId || c.id || `ch-${c.chapterNumber ?? i + 1}`;
      chapterOrder[id] = i;
    });
  } catch { /* no syllabus → fall back to the stable slug order below */ }
  const kindRank = (k: string) => (k === 'summary' ? -3 : k === 'shortened' ? -2 : k === 'overview' ? -1 : 0);
  clips.sort(
    (a, b) =>
      kindRank(a.artifact) - kindRank(b.artifact) ||
      (chapterOrder[a.sectionId ?? ''] ?? 1e6) - (chapterOrder[b.sectionId ?? ''] ?? 1e6) ||
      String(a.sectionId ?? '').localeCompare(String(b.sectionId ?? '')),
  );
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
  const diaUrl = opts.diaUrl ?? DEFAULT_DIA;
  const target = opts.playbackTarget ?? DEFAULT_TARGET;
  // QC is on by default when a key exists and CHIRON_AUDIO_QC is not "0".
  const qcEnabled = opts.qc !== undefined
    ? opts.qc
    : qcAvailable() && process.env['CHIRON_AUDIO_QC'] !== '0';
  const db = new Database(join(lessonDir, '.chiron-state.db'));
  const results: AudioClipResult[] = [];
  // Accumulate QC results for the final report.
  // qcReportEntries: labels with SURVIVING defects; qcCheckedLabels: every label QC'd this run.
  const qcReportEntries = new Map<string, QcDefectEntry[]>();
  const qcCheckedLabels = new Set<string>();

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

  let modalRoot: string | null = null;   // hoisted so the finally can clean the Modal prefetch tree (F3-leak)
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

    // ── ENGINE banner: make it unmistakable in the bake log WHICH backend is synthesizing this lesson ──
    const _ovHost = opts.omnivoiceUrl || DEFAULT_OV;
    if (opts.engine === 'modal') {
      progress(STAGE, `════════ ENGINE: ⚡ MODAL fast-bake · app "chiron-bake" fn bake_lesson · L4 GPU (cloud, concurrent, paid ~per GPU-sec) ════════`);
    } else {
      progress(STAGE, `════════ ENGINE: 🐢 MAC · OmniVoice sidecar @ ${_ovHost} (Mac Studio, serial, free) ════════`);
    }

    // engine='modal': fan the WHOLE lesson's synth out to the Modal L4 lane (bucketed CUDA) up front.
    // Writes raw per-segment WAVs to prefetch/<artifactHash>/<i>.wav; the loop below then copies those
    // in instead of synthesizing (everything else — normalize/manifest/splice/mp3/QC — is unchanged).
    // ANY failure leaves modalPrefetch=null and every segment falls back to the Mac sidecar.
    let modalPrefetch: string | null = null;         // modalRoot is hoisted above the try (finally cleans it)
    if (opts.engine === 'modal' && opts.modalSynthScript) {
      try {
        // Only fan out artifacts that will ACTUALLY be synthesized:
        //  · F2 — skip reuse-hits (a clip whose script_hash matches an existing done mp3) → don't pay GPU
        //          for clips that are free on the Mac path.
        //  · F6 — skip Dia artifacts → they synthesize on the Dia sidecar; an OmniVoice prefetch would
        //          hijack them (the prefetch-copy branch runs before the `if(useDia)` check).
        const toBake = ordered.filter((art) => {
          if (art.engine === 'dia') return false;
          const ex = findExisting.get(opts.courseId, art.kind, art.sectionId ?? '') as
            | { scriptHash: string; audioPath: string | null } | undefined;
          const reuse = !!(ex && ex.scriptHash === hashSegments(art.segments) && ex.audioPath && existsSync(join(lessonDir, ex.audioPath)));
          return !reuse;
        });
        if (toBake.length === 0) {
          progress(STAGE, `[modal] nothing to synth — all ${ordered.length} artifacts reused (script unchanged) → skipping Modal entirely (no GPU, $0)`);
        } else {
          const usedVoices = new Set<string>();
          for (const art of toBake) for (const s of art.segments) usedVoices.add(s.voice);
          const refs: Record<string, { wav: string; txt: string }> = {};
          for (const v of usedVoices) {
            const vr = opts.voices[v];
            if (!vr) throw new Error(`voice '${v}' not registered — cannot fast-bake on Modal`);   // F5: fail fast + clear
            refs[v] = { wav: basename(vr.refAudio), txt: vr.refText };
          }
          const sections: Record<string, Array<{ voice: string; lang: string; text: string }>> = {};
          for (const art of toBake) {
            sections[hashSegments(art.segments)] = art.segments.map((s) => ({ voice: s.voice, lang: s.lang, text: s.text }));
          }
          const job = { slug: opts.courseId, num_step: 48, bucket: 8, refs, sections };
          modalRoot = mkdtempSync(join(tmpdir(), 'chiron-modal-'));
          const jobPath = join(modalRoot, 'job.json');
          const prefDir = join(modalRoot, 'prefetch');
          writeFileSync(jobPath, JSON.stringify(job));
          const _segCount = toBake.reduce((n, a) => n + a.segments.length, 0);
          progress(STAGE, `[modal] connecting → Modal chiron-bake/bake_lesson (L4) · fanning ${toBake.length}/${ordered.length} artifacts, ${_segCount} segments (bucket=8; ${ordered.length - toBake.length} reused/Dia skipped, not sent)…`);
          const _t0 = Date.now();
          const out = execFileSync('python3', [opts.modalSynthScript, jobPath, prefDir], {
            encoding: 'utf8', timeout: 1_800_000, maxBuffer: 8 * 1024 * 1024,
          });
          const res = JSON.parse(out.trim().split('\n').pop() || '{}');
          if (res.error) throw new Error(String(res.error));
          modalPrefetch = prefDir;
          const _wall = ((Date.now() - _t0) / 1000).toFixed(1);
          progress(STAGE, `[modal] ⚡ L4 returned ${res.clips} clips · ${res.synth_s}s GPU-synth / ${_wall}s round-trip → prefetched, now splicing LOCALLY (normalize→splice→mp3, byte-identical to Mac)`);
        }
      } catch (e) {
        if (modalRoot) { try { rmSync(modalRoot, { recursive: true, force: true }); } catch { /* best-effort */ } }  // F3-leak
        modalRoot = null;
        // A TOTAL fan-out failure (Modal down/unauthed) must NOT silently degrade the whole lesson onto
        // the single Mac sidecar — under a concurrent rebake-all that's 12 lessons stampeding one TTS
        // engine (F3), and it violates "Modal only on explicit selection". Fail cleanly instead; the
        // user retries or picks 🐢 Mac deliberately. (Per-segment prefetch misses below still fall back,
        // but those are a handful of clips, not a whole batch.)
        const msg = e instanceof Error ? e.message : String(e);
        progress(STAGE, `engine=modal FAILED (${msg.slice(0, 80)}) — NOT falling back to the Mac (avoids contention)`);
        throw new Error(`Modal fast-bake unavailable (${msg.slice(0, 120)}). Nothing baked — retry, or use the 🐢 Mac option explicitly.`);
      }
    }

    for (const art of ordered) {
      const sid = art.sectionId ?? '';
      const label = `${art.kind}${sid ? `/${sid}` : ''}`;
      const hash = hashSegments(art.segments);
      const relPath = relAudioPath(art.kind, sid);

      // Deterministic audio-vs-DISPLAY divergence check (no model). Runs for any
      // `section` whose displayed text was supplied — regardless of bake/reuse
      // status — so a narration that was rewritten away from the screen is flagged.
      if (art.kind === 'section' && opts.displayedText && opts.displayedText[sid]) {
        const audioText = art.segments.map((s) => s.text).join(' ');
        const containment = displayContainment(audioText, opts.displayedText[sid]!);
        const dlbl = panelLabel(art.kind, sid);
        qcCheckedLabels.add(dlbl);
        if (containment < DIVERGENCE_MIN_CONTAINMENT) {
          const prior = qcReportEntries.get(dlbl) ?? [];
          prior.push({
            time: '',
            type: 'divergence',
            detail:
              `audio narration diverges from the displayed '${sid}' text ` +
              `(only ${Math.round(containment * 100)}% of on-screen words are spoken; ` +
              `threshold ${Math.round(DIVERGENCE_MIN_CONTAINMENT * 100)}%)`,
          });
          qcReportEntries.set(dlbl, prior);
          progress(STAGE, `DIVERGENCE ${label}: audio ≠ display (containment ${Math.round(containment * 100)}%)`);
        }
      }

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

        const useDia = art.engine === 'dia';
        const diaParams: DiaParams = {
          speaker: art.speaker ?? 'S1',
          speed: art.speed ?? 1.0,
          emotion: art.emotion ?? 'neutral',
        };
        const fallbackMode = art.fallback ?? 'omni';

        /**
         * Synth ONE segment to `rawWav`. For a Dia artifact: try Dia first; on ANY
         * Dia failure with fallback==='omni', synth via OmniVoice and (if speed<1.0)
         * apply a pitch-preserved atempo so the fallback keeps the slow reading.
         * Returns which engine actually produced the clip (for logging).
         */
        const synthSegmentToWav = async (seg: LectureSegment, rawWav: string, prefetchWav?: string): Promise<SynthEngine> => {
          // engine=modal: the raw synth already exists (from the Modal lane) → copy it in, skip synth.
          // The slow-read atempo still applies locally, so slow passages match the Mac path exactly.
          if (prefetchWav && existsSync(prefetchWav)) {
            copyFileSync(prefetchWav, rawWav);
            if (diaParams.speed < 1.0) {
              const slowed = `${rawWav}.slow.wav`;
              execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawWav, '-filter:a', `atempo=${diaParams.speed}`, slowed], { stdio: 'pipe' });
              renameSync(slowed, rawWav);
            }
            return 'modal';   // copied from the Modal L4 prefetch → report the true engine in the per-segment log
          }
          if (useDia) {
            try {
              await synthDiaSegment(diaUrl, seg, diaParams, rawWav);
              return 'dia';
            } catch (diaErr) {
              if (fallbackMode !== 'omni') throw diaErr;
              const msg = diaErr instanceof Error ? diaErr.message : String(diaErr);
              progress(STAGE, `  Dia failed (${msg.slice(0, 44)}) — falling back to OmniVoice`);
              const ref = opts.voices[seg.voice];
              if (!ref) throw new Error(`no voice ref registered for '${seg.voice}' (Dia fallback)`);
              await synthWithRetry(url, seg, ref, rawWav);
              if (diaParams.speed < 1.0) {
                const slowed = `${rawWav}.slow.wav`;
                execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawWav, '-filter:a', `atempo=${diaParams.speed}`, slowed], { stdio: 'pipe' });
                renameSync(slowed, rawWav);
              }
              return 'omni';
            }
          }
          const ref = opts.voices[seg.voice];
          if (!ref) throw new Error(`no voice ref registered for '${seg.voice}'`);
          await synthWithRetry(url, seg, ref, rawWav);
          // OmniVoice slow read: apply pitch-preserved atempo for any omni section
          // with speed<1.0. This is the Italian slow-reading path — Dia is English-
          // only, so `language-it` passage slow-reads use omni+atempo (same voice as
          // the fast read, just slowed/enunciated).
          if (diaParams.speed < 1.0) {
            const slowed = `${rawWav}.slow.wav`;
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawWav, '-filter:a', `atempo=${diaParams.speed}`, slowed], { stdio: 'pipe' });
            renameSync(slowed, rawWav);
          }
          return 'omni';
        };

        // 1) SYNTH each segment → rawWav, SERIAL: the Mac OmniVoice sidecar cannot take parallel requests;
        //    on the modal path this is just a fast local copy of the prefetched clip.
        for (let i = 0; i < art.segments.length; i++) {
          const seg = art.segments[i]!;
          const rawWav = join(work, `raw${i}.wav`);
          const pfWav = modalPrefetch ? join(modalPrefetch, hash, `${i}.wav`) : undefined;
          const willEng = (pfWav && existsSync(pfWav)) ? 'modal-L4' : (useDia ? 'dia' : 'omni-mac');
          progress(STAGE, `${label}: segment ${i + 1}/${art.segments.length} [${seg.lang}] synth (engine=${willEng})`, {
            pct: Math.round((i / art.segments.length) * 100),
          });
          const produced = await synthSegmentToWav(seg, rawWav, pfWav);
          progress(STAGE, `${label}: segment ${i + 1}/${art.segments.length} produced by ${produced}`);
        }
        // 2) NORMALIZE each rawWav → segWav. PARALLEL on the modal local pipeline (the sequential ffmpeg
        //    normalize was the felt bottleneck on big lessons); serial on Mac. Per-clip output is byte-identical.
        // Resilience: a synth can occasionally return an EMPTY clip (blank/whitespace segment, or a rare
        // model miss). tts-normalize crashes on zero-size audio ("zero-size array to reduction maximum"),
        // which would fail the ENTIRE lesson over one bad segment. Skip empties instead (a valid WAV is KBs;
        // an empty one is a ~44-byte header or 0). This keeps one blank clip from sinking the whole bake.
        const validIdx = art.segments.map((_s, i) => i).filter((i) => {
          try { return existsSync(join(work, `raw${i}.wav`)) && statSync(join(work, `raw${i}.wav`)).size > 512; }
          catch { return false; }
        });
        if (validIdx.length < art.segments.length) {
          progress(STAGE, `${label}: ⚠ skipped ${art.segments.length - validIdx.length} empty/blank segment(s) (kept ${validIdx.length}/${art.segments.length})`);
        }
        const NORM_CONC = modalPrefetch ? Math.max(1, parseInt(process.env.CHIRON_SPLICE_CONC || '6', 10) || 6) : 1;
        await mapLimit(validIdx, NORM_CONC, async (i) => {
          await execFileAsync('tts-normalize', [join(work, `raw${i}.wav`), join(work, `seg${i}.wav`), String(target)]);
        });
        const manifestLines: string[] = validIdx.map((i, k) => {
          const seg = art.segments[i]!;
          const gap = k < validIdx.length - 1 ? seg.gapAfterMs : 0;   // no trailing gap after the last KEPT segment
          return `${join(work, `seg${i}.wav`)}|${gap}${seg.gainDb != null ? `|${seg.gainDb}` : ''}`;
        });

        const manifestPath = join(work, 'manifest.txt');
        writeFileSync(manifestPath, `${manifestLines.join('\n')}\n`);
        const splicedWav = join(work, 'spliced.wav');
        execFileSync('tts-splice', [splicedWav, '--manifest', manifestPath], { stdio: 'pipe' });
        const finalWav = join(work, 'final.wav');
        execFileSync('tts-normalize', [splicedWav, finalWav, String(target)], { stdio: 'pipe' });

        const absPath = join(lessonDir, relPath);
        mkdirSync(dirname(absPath), { recursive: true });

        /** Inner helper: synth all segments + splice + normalize + encode to mp3. */
        const synthAndEncode = async (): Promise<void> => {
          mkdirSync(work, { recursive: true });
          const mLines: string[] = [];
          for (let i = 0; i < art.segments.length; i++) {
            const seg = art.segments[i]!;
            const rawWav2 = join(work, `raw${i}.wav`);
            const segWav2 = join(work, `seg${i}.wav`);
            await synthSegmentToWav(seg, rawWav2);
            execFileSync('tts-normalize', [rawWav2, segWav2, String(target)], { stdio: 'pipe' });
            const gap2 = i < art.segments.length - 1 ? seg.gapAfterMs : 0;
            mLines.push(`${segWav2}|${gap2}${seg.gainDb != null ? `|${seg.gainDb}` : ''}`);
          }
          const mPath = join(work, 'manifest.txt');
          writeFileSync(mPath, `${mLines.join('\n')}\n`);
          const spliced2 = join(work, 'spliced.wav');
          execFileSync('tts-splice', [spliced2, '--manifest', mPath], { stdio: 'pipe' });
          const final2 = join(work, 'final.wav');
          execFileSync('tts-normalize', [spliced2, final2, String(target)], { stdio: 'pipe' });
          mkdirSync(dirname(absPath), { recursive: true });
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', final2, '-codec:a', 'libmp3lame', '-q:a', '4', absPath], { stdio: 'pipe' });
        };

        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', finalWav, '-codec:a', 'libmp3lame', '-q:a', '4', absPath], { stdio: 'pipe' });

        // QC pass — best-effort; never blocks.
        let finalQcDefects: string[] = [];
        if (qcEnabled) {
          const expectedText = art.segments.map((s) => s.text).join(' ');
          progress(STAGE, `QC ${label} — checking with Gemini…`);
          const take1 = await qcAudioClip(absPath, expectedText);
          if (!take1.clean && take1.defects.length > 0 && modalPrefetch) {
            // F4: the take-2 re-bake (synthAndEncode) synthesizes on the single Mac sidecar — under a
            // concurrent Modal rebake-all that's the exact stampede F3 prevents. For a Modal bake, keep
            // take 1 and just LOG the defect (re-bakeable later), rather than contending the Mac.
            progress(STAGE, `QC ${label}: defects on take 1 (${take1.defects.length}) — logged (Modal bake; no Mac re-bake)`);
            finalQcDefects = take1.defects;
          } else if (!take1.clean && take1.defects.length > 0) {
            progress(STAGE, `QC ${label}: defects on take 1 (${take1.defects.length}) — re-baking…`);
            try {
              await synthAndEncode();
              const take2 = await qcAudioClip(absPath, expectedText);
              finalQcDefects = (!take2.clean && take2.defects.length > 0) ? take2.defects : [];
            } catch (rebakeErr) {
              // Re-bake failed — keep take 1 result and carry on.
              const msg2 = rebakeErr instanceof Error ? rebakeErr.message : String(rebakeErr);
              progress(STAGE, `QC re-bake failed for ${label}: ${msg2} — keeping take 1`);
              finalQcDefects = take1.defects;
            }
          }
          const lbl = panelLabel(art.kind, sid);
          qcCheckedLabels.add(lbl);
          if (finalQcDefects.length > 0) {
            // Append — a divergence defect for this label may already be present.
            const prior = qcReportEntries.get(lbl) ?? [];
            prior.push(...finalQcDefects.map((d) => ({
              time: parseDefectTime(d),
              type: inferDefectType(d),
              detail: d,
            })));
            qcReportEntries.set(lbl, prior);
            progress(STAGE, `QC ${label}: ${finalQcDefects.length} defect(s) surviving — logged to qc-report.json`);
          } else {
            progress(STAGE, `QC ${label}: clean`);
          }
        }

        const dur = probeDuration(absPath);
        upsert.run(buildRow(opts.courseId, art, sid, hash, 'done', {
          audio_path: relPath,
          duration_s: dur,
          bytes: statSync(absPath).size,
          lufs: target,
          reuse_count: existing ? existing.reuseCount : 0,
        }));
        const clipResult: AudioClipResult = { artifact: art.kind, sectionId: sid, status: 'done', audioPath: relPath };
        if (finalQcDefects.length > 0) clipResult.qcDefects = finalQcDefects;
        results.push(clipResult);
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
    // Write the report whenever ANY label was checked — Gemini QC OR the
    // deterministic divergence check (which runs even when Gemini QC is off).
    if (qcCheckedLabels.size > 0) {
      mergeQcReport(lessonDir, qcReportEntries, qcCheckedLabels);
    }
    const qcSummary = qcEnabled
      ? `, qc: ${baked} checked, ${qcReportEntries.size} with surviving defects${qcReportEntries.size > 0 ? ' (qc-report.json written)' : ''}`
      : '';
    progress(STAGE, `done — ${baked} baked, ${reused} reused, ${failed} failed of ${ordered.length}${qcSummary}`);
    return results;
  } finally {
    if (modalRoot) { try { rmSync(modalRoot, { recursive: true, force: true }); } catch { /* best-effort */ } }  // F3-leak: clean the Modal prefetch WAV tree on every exit
    db.close();
  }
}
