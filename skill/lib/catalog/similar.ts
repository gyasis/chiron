/**
 * Chiron assessment — Tier 2 "Cross-pollinate": surface ALREADY-VERIFIED similar
 * questions from OTHER lessons (assessment-engine PRD §4).
 *
 * No generation, no hallucination, offline — pure queries over the local catalog
 * (storage PRD). Two strategies, both safe (they only return cards already in the
 * bank, i.e. already verified at lesson-build):
 *   - byConcept: cards sharing the same concept_id from a DIFFERENT bundle.
 *   - byText: FTS5 match on the source card's front, excluding same-bundle hits.
 *
 * These are SEPARATE stable cards (each its own SR unit) — Tier 2 surfaces them
 * for variety; it does not merge their SR state.
 */

import type { Catalog } from './db.js';

export interface SimilarCard {
  id: string;
  bundle_id: string;
  concept_id: string | null;
  front: string;
  domain: string;
  via: 'concept' | 'fts';
}

/** Sibling cards sharing the concept, from other lessons (verified, cross-lesson). */
export function byConcept(cat: Catalog, cardId: string, k = 5): SimilarCard[] {
  const src = cat.raw.prepare('SELECT concept_id, bundle_id FROM cards WHERE id=?').get(cardId) as
    { concept_id: string | null; bundle_id: string } | undefined;
  if (!src?.concept_id) return [];
  return cat.raw.prepare(`
    SELECT c.id, c.bundle_id, c.concept_id, c.front, b.domain
      FROM cards c JOIN bundles b ON b.id = c.bundle_id
     WHERE c.concept_id = ? AND c.bundle_id != ? AND c.id != ?
     LIMIT ?`).all(src.concept_id, src.bundle_id, cardId, k)
    .map((r) => ({ ...(r as object), via: 'concept' } as SimilarCard));
}

/** FTS-similar cards by the source front text, excluding the source's own bundle. */
export function byText(cat: Catalog, cardId: string, k = 5): SimilarCard[] {
  const src = cat.raw.prepare('SELECT front, bundle_id FROM cards WHERE id=?').get(cardId) as
    { front: string; bundle_id: string } | undefined;
  if (!src?.front) return [];
  // Build a safe FTS query from the front's word tokens (OR-joined, quoted).
  const terms = src.front.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  if (terms.length === 0) return [];
  const q = [...new Set(terms)].slice(0, 8).map((t) => `"${t}"`).join(' OR ');
  try {
    return cat.raw.prepare(`
      SELECT c.id, c.bundle_id, c.concept_id, c.front, b.domain
        FROM cards_fts f JOIN cards c ON c.id = f.card_id JOIN bundles b ON b.id = c.bundle_id
       WHERE cards_fts MATCH ? AND c.bundle_id != ? AND c.id != ?
       ORDER BY rank LIMIT ?`).all(q, src.bundle_id, cardId, k)
      .map((r) => ({ ...(r as object), via: 'fts' } as SimilarCard));
  } catch { return []; }
}

/** Combined: concept siblings first (highest precision), then FTS, deduped. */
export function similar(cat: Catalog, cardId: string, k = 5): SimilarCard[] {
  const seen = new Set<string>();
  const out: SimilarCard[] = [];
  for (const c of [...byConcept(cat, cardId, k), ...byText(cat, cardId, k)]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
    if (out.length >= k) break;
  }
  return out;
}
