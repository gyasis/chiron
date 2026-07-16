/**
 * Chiron — Zod schema + resolver for the Stage-04s lecture script ("Listen mode").
 *
 * Gemini (the pedagogy script author) emits a `LectureScript`: per-granularity
 * teaching scripts as language-tagged segments, each with a per-join GAP CLASS
 * and an optional `<ref>` anchor — PEDAGOGY ONLY, no voice knowledge. The
 * deterministic `resolveLecture()` then maps (lang, domain) → the registered
 * OmniVoice voice and gap class → milliseconds, producing the `LectureArtifact[]`
 * that `lib/audio-bake.ts` consumes.
 *
 * Design + gap policy + per-language voice routing: PRD chiron_audio_lecture_2026-06-09.
 */

import { z } from 'zod';
import type { LectureArtifact, LectureSegment, SynthEngine } from '../audio-bake.js';

/** Engine ∈ {omni,dia} — which sidecar synthesizes a section artifact. */
export const SynthEngineSchema = z.enum(['omni', 'dia']);

export const SegLangSchema = z.enum(['en', 'it']);

/** Per-join pause class — resolved to milliseconds by {@link GAP_MS}. */
export const GapClassSchema = z.enum(['word', 'clause', 'sentence', 'paragraph']);
export type GapClass = z.infer<typeof GapClassSchema>;

export const ArtifactKindSchema = z.enum([
  // floating-panel lectures
  'summary', 'shortened', 'section',
  // inline (anchored to a DOM element, played via an inline ▶)
  'dialogue', 'phrase', 'grammar-pearl', 'story-verbatim', 'story-description',
]);

/** Kinds that attach to a DOM element (need `sectionId` = the anchor id). */
const ANCHORED_KINDS = new Set([
  'section', 'dialogue', 'phrase', 'grammar-pearl', 'story-verbatim', 'story-description',
]);

/** One language-tagged span of a lecture (Gemini authors these — no `voice`). */
export const LectureScriptSegmentSchema = z.object({
  lang: SegLangSchema,
  text: z.string().min(1),
  /** Pause AFTER this segment before the next (the last segment's is forced to 0). */
  gapAfter: GapClassSchema.default('sentence'),
  /** DOM anchor this span teaches about (voice-follow) — section artifacts only. */
  refAnchor: z.string().optional(),
});
export type LectureScriptSegment = z.infer<typeof LectureScriptSegmentSchema>;

export const LectureScriptArtifactSchema = z
  .object({
    kind: ArtifactKindSchema,
    /** DOM id of the section this lecture covers — REQUIRED iff kind === 'section'. */
    sectionId: z.string().optional(),
    segments: z.array(LectureScriptSegmentSchema).min(1),
    /** Synthesis engine override (default omni). Dia routes the slow reading. */
    engine: SynthEngineSchema.optional(),
    /** Dia speaker tag (S1/S2/S3). */
    speaker: z.string().optional(),
    /** Dia speed (<1.0 = slower, pitch-preserved). Also drives the OmniVoice fallback atempo. */
    speed: z.number().optional(),
    /** Dia emotion ∈ {neutral,calm,measured,warm,expressive}. */
    emotion: z.string().optional(),
    /** On Dia failure: 'omni' (default) → OmniVoice fallback; 'none' → let it fail. */
    fallback: z.enum(['omni', 'none']).optional(),
  })
  .refine((a) => !ANCHORED_KINDS.has(a.kind) || (a.sectionId !== undefined && a.sectionId.length > 0), {
    message: 'this artifact kind requires a non-empty sectionId (the DOM anchor it attaches to)',
  });
export type LectureScriptArtifact = z.infer<typeof LectureScriptArtifactSchema>;

export const LectureScriptSchema = z.object({
  artifacts: z.array(LectureScriptArtifactSchema).min(1),
});
export type LectureScript = z.infer<typeof LectureScriptSchema>;

/** Per-join pause class → milliseconds (PRD gap policy, Gemini-researched 2026-06-09). */
export const GAP_MS: Record<GapClass, number> = {
  word: 60, // word-level switch (e.g. an Italian word inside an English clause) — tight
  clause: 400,
  sentence: 900,
  paragraph: 1800,
};

export type LectureDomain = 'code' | 'medicine' | 'language-it' | 'research-paper' | 'concepts';

/**
 * (lang, domain) → registered OmniVoice voice. The Italian language domain uses
 * the BILINGUAL Lucrezia (en + it); other domains use `pauls_tutor` for English
 * and fall back to `lucrezia_italian` for any Italian span.
 */
export function voiceFor(lang: 'en' | 'it', domain: LectureDomain): string {
  if (domain === 'language-it') return lang === 'it' ? 'lucrezia_italian' : 'lucrezia_english';
  return lang === 'it' ? 'lucrezia_italian' : 'pauls_tutor';
}

/** Strip surrounding quotes/guillemets + leading/trailing punctuation & space for a name-equality test. */
function stripForName(s: string): string {
  return s
    .replace(/[«»"'“”‘’]/g, ' ')
    .replace(/^[\s.,;:!?—–-]+/, '')
    .replace(/[\s.,;:!?—–-]+$/, '')
    .trim();
}

/**
 * Fold any segment whose entire text IS the learner's name (± surrounding
 * punctuation) into the NEXT segment (adopting its lang/voice), so a personal
 * name is never synthesized as its own isolated clip — an isolated one-word clip
 * is separately loudness-normalized + spliced, which the learner hears as a cut
 * around their name. Falls back to appending to the PREVIOUS segment if the name
 * is the last segment. General for ANY name; a real Italian teaching token never
 * equals the learner name, so intentionally-isolated `lang:"it"` target words are
 * left untouched.
 */
function mergeLearnerNameSegments(
  segs: LectureScriptSegment[],
  name?: string,
): LectureScriptSegment[] {
  const target = (name ?? '').trim().toLowerCase();
  if (!target) return segs;
  const out: LectureScriptSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = { ...segs[i]! };
    const isJustName = stripForName(seg.text).toLowerCase() === target;
    if (isJustName && i < segs.length - 1) {
      // fold into the FOLLOWING segment (keeps the name's punctuation, e.g. "Gyasi —")
      const next = { ...segs[i + 1]! };
      next.text = `${seg.text.trim()} ${next.text}`.replace(/\s+/g, ' ').trim();
      segs[i + 1] = next; // carry the merge forward
      continue; // drop the standalone name segment → no internal gap around the name
    }
    if (isJustName && out.length > 0) {
      const prev = out[out.length - 1]!;
      prev.text = `${prev.text} ${seg.text.trim()}`.replace(/\s+/g, ' ').trim();
      continue; // last segment is bare name → append to previous
    }
    out.push(seg);
  }
  return out;
}

/**
 * Resolve a Gemini `LectureScript` into `LectureArtifact[]` for `bakeAudio`:
 * assign the routed voice per segment and convert each gap class to ms (the
 * last segment of every artifact gets gap 0). If `learnerName` is given, a bare
 * name segment is first folded into its neighbor (see mergeLearnerNameSegments).
 */
export function resolveLecture(script: LectureScript, domain: LectureDomain, learnerName?: string): LectureArtifact[] {
  return script.artifacts.map((art) => {
    const merged = mergeLearnerNameSegments(art.segments, learnerName);
    const segments: LectureSegment[] = merged.map((seg, i) => {
      const out: LectureSegment = {
        lang: seg.lang,
        text: seg.text,
        voice: voiceFor(seg.lang, domain),
        // default-safe: a segment built without an explicit gapAfter (callers that
        // skip Zod parsing) must never yield undefined → tts-splice float error.
        gapAfterMs: i === merged.length - 1 ? 0 : (GAP_MS[seg.gapAfter] ?? GAP_MS.sentence),
      };
      if (seg.refAnchor) out.refAnchor = seg.refAnchor;
      return out;
    });
    const artifact: LectureArtifact = { kind: art.kind, segments };
    if (art.sectionId) artifact.sectionId = art.sectionId;
    // Pass engine params through for section artifacts (read at bake time).
    // Voices are still assigned per segment above, so the OmniVoice fallback works.
    if (art.engine) artifact.engine = art.engine as SynthEngine;
    if (art.speaker) artifact.speaker = art.speaker;
    if (art.speed !== undefined) artifact.speed = art.speed;
    if (art.emotion) artifact.emotion = art.emotion;
    if (art.fallback) artifact.fallback = art.fallback;
    return artifact;
  });
}
