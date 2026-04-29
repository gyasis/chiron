/**
 * Persona file schema (Zod) — pins the canonical `expert + peers` structure
 * used by `<chiron>/skill/personas/*.json`.
 *
 * The shape is:
 *   {
 *     domain: 'code' | 'medicine' | 'language-it' | 'research-paper',
 *     version: string,
 *     expert: Persona,
 *     peers:  Persona[]
 *   }
 *
 * Rationale (recorded 2026-04-29 follow-up): tasks.md (T036/T053/T069)
 * implied a flat `personas[]` array, but all three checked-in persona files
 * use the structured `expert + peers` shape. The structured form wins —
 * it's semantically clearer (one expert per domain, multiple peers) and
 * lets downstream consumers index by role without scanning.
 *
 * This schema exists so future persona files can be validated at load
 * time and cannot drift back to the flat-array convention.
 */

import { z } from 'zod';

/** Canonical Chiron domain identifiers (mirrors `Brief.domain`). */
export const PersonaDomainSchema = z.enum([
  'code',
  'medicine',
  'language-it',
  'research-paper',
]);
export type PersonaDomain = z.infer<typeof PersonaDomainSchema>;

/**
 * A single persona — either the domain expert or a peer learner.
 *
 * Required fields are the minimum needed by the lesson-rendering layer to
 * emit dialog turns and tag them by speaker. `ttsVoice` is optional and
 * only used by the language-it native-speaker tutor (Maria).
 */
export const PersonaSchema = z.object({
  /** Stable identifier used in dialog turn `speakerId`. */
  id: z.string().min(1),
  /** Display name shown in the lesson UI. */
  name: z.string().min(1),
  /** Pedagogical role — free-form but conventionally hyphenated. */
  role: z.string().min(1),
  /** 3-5 short adjectives that shape generated dialogue. */
  traits: z.array(z.string().min(1)).min(1),
  /** 1-2 sentence voice description — guides LLM tone. */
  voice: z.string().min(1),
  /** When this persona should speak in a lesson (turn-trigger heuristic). */
  whenToSpeak: z.string().min(1),
  /** 2-4 representative example utterances (anchors for few-shot prompting). */
  example_lines: z.array(z.string().min(1)).min(1),
  /** Optional TTS voice handle (e.g. Gemini voice id). Currently used only by Maria. */
  ttsVoice: z.string().min(1).optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

/**
 * The full persona file shape: one expert + N peers, scoped to a domain.
 *
 * `version` is a string (not number) so we can use semver-ish tags
 * later without a migration.
 */
export const PersonaFileSchema = z.object({
  domain: PersonaDomainSchema,
  version: z.string().min(1),
  expert: PersonaSchema,
  peers: z.array(PersonaSchema).min(1),
});
export type PersonaFile = z.infer<typeof PersonaFileSchema>;
