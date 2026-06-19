/**
 * Chiron catalog — ID helpers (storage-consolidation PRD §5, §12).
 *
 * Two id concerns:
 *  - ULIDs for rows that need a globally-unique, mergeable id (multi-user
 *    on-ramp: never auto-increment — see PRD §7). Hand-rolled, no dependency.
 *  - The card-ID fallback LADDER for migration (PRD §12): legacy lessons have
 *    NO SR history (0 .chiron-state.db on disk), so legacy cards need only a
 *    deterministic, collision-free id — not a lineage-stable one. Stable
 *    concept-based ids matter only going forward (Tier 1).
 */

import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Monotonic-enough ULID (48-bit time + 80-bit random, Crockford base32). */
export function ulid(now: number = Date.now()): string {
  let ts = now;
  const time = new Array(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = CROCKFORD[ts % 32];
    ts = Math.floor(ts / 32);
  }
  const rand = randomBytes(10);
  const r = new Array(16);
  for (let i = 0; i < 16; i++) r[i] = CROCKFORD[rand[i % 10]! % 32];
  return time.join('') + r.join('');
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

/**
 * Resolve a card's id per the PRD §12 fallback ladder.
 *
 * @param bundleId  stable bundle id (author slug or content hash)
 * @param card      a card record from a bundle (may carry concept_id/conceptId, chapterId)
 * @param ordinal   position of this card within its chapter/bundle (deterministic)
 */
export function resolveCardId(
  bundleId: string,
  card: { concept_id?: string; conceptId?: string; chapterId?: string; front?: string },
  ordinal: number,
): { id: string; tier: 1 | 2 | 3 } {
  const concept = card.concept_id ?? card.conceptId;
  if (concept) {
    // Tier 1 — stable, cross-lesson-shareable (post-generator-update lessons).
    return { id: `${concept}:${ordinal}`, tier: 1 };
  }
  if (card.chapterId) {
    // Tier 2 — legacy bundle with structured cards but no concept_id.
    return { id: `${bundleId}:${card.chapterId}:${ordinal}`, tier: 2 };
  }
  // Tier 3 — no structure: content-hash within the bundle (collision-safe).
  const basis = card.front ? shortHash(card.front) : String(ordinal);
  return { id: `${bundleId}:${basis}`, tier: 3 };
}

/** Stable bundle id from an author slug (strip trailing -YYYY-MM-DD date stamp so v1/v2 share lineage). */
export function bundleIdFromName(name: string): string {
  return name
    .replace(/\.chiron$/i, '')
    .replace(/^chiron-/, '')
    .replace(/-\d{4}-\d{2}-\d{2}(-v\d+)?$/i, '$1')
    .replace(/-v\d+$/i, '');
}
