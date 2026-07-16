/**
 * Chiron assessment — Tier 1 "Hydration": MEANING-PRESERVING surface variation
 * of an already-verified question (assessment-engine PRD §4).
 *
 * Deterministic + seeded (by card id + review count): the same card varies its
 * presentation across exposures but is reproducible for a given (card, exposure)
 * — so a replay of the event log reconstructs exactly what the learner saw.
 *
 * ONLY meaning-preserving transforms live here:
 *   - MCQ option shuffle (+ repoint the correct-answer index)
 *   - stable ordering of a set of cards/sections
 * NOT numeric/synonym swap — that mutates content (a changed lab value changes
 * the medicine) and belongs in gated Tier 3.
 *
 * Pure: no DB, no LLM, offline. The SR unit (card_id) is unchanged — this only
 * re-skins the surface of the SAME stable question.
 */

import { createHash } from 'node:crypto';

/** Deterministic 32-bit PRNG (mulberry32) from an integer seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer seed from a string (cardId) + a salt (exposure/review count). */
export function seedFrom(cardId: string, salt: number): number {
  const h = createHash('sha256').update(`${cardId}#${salt}`).digest();
  return h.readUInt32BE(0);
}

/** Seeded Fisher-Yates — returns the permutation (indices) without mutating input. */
function permutation(n: number, rnd: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx;
}

export interface McqQuestion {
  stem: string;
  options: string[];
  answerIndex: number; // index into options of the correct answer
}

/**
 * Tier-1 hydrate an MCQ: shuffle options deterministically and repoint the
 * answer. Identity (card_id) and difficulty are unchanged — only option order
 * differs, breaking positional/length memorization ("the answer is always C").
 *
 * @param exposure  review count for this card — varies the shuffle per exposure
 *                  while staying reproducible (seed = cardId#exposure).
 */
export function hydrateMcq(cardId: string, q: McqQuestion, exposure: number): McqQuestion {
  if (q.options.length < 2) return q;
  const rnd = mulberry32(seedFrom(cardId, exposure));
  const perm = permutation(q.options.length, rnd);
  const options = perm.map((i) => q.options[i]!);
  const answerIndex = perm.indexOf(q.answerIndex);
  return { stem: q.stem, options, answerIndex };
}

/** Tier-1 stable ordering of a set (e.g. the cards in a session) — seeded, reproducible. */
export function hydrateOrder<T>(items: T[], seedKey: string, salt: number): T[] {
  const rnd = mulberry32(seedFrom(seedKey, salt));
  return permutation(items.length, rnd).map((i) => items[i]!);
}
