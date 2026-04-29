/**
 * Chiron — SM-2 spaced-repetition scheduler (T014, R-07).
 *
 * Classic SM-2 (SuperMemo 2) — ~50 LOC, no external deps. Inputs and outputs
 * are aligned to the `sr_cards` columns from `contracts/sqlite-schema.sql`.
 *
 * Rating semantics (matches sr_review_log.rating):
 *   1 = again  (lapse — reset interval, lower ease floor)
 *   2 = hard   (interval grows slowly, ease drops)
 *   3 = good   (standard SM-2 progression)
 *   4 = easy   (extra ease bonus, larger interval bump)
 */

import type Database from 'better-sqlite3';

export type Rating = 1 | 2 | 3 | 4;

/** Subset of the `sr_cards` row needed by the scheduler. */
export interface SrCardState {
  id?: number;
  ease_factor: number;     // SM-2 EF; floor 1.3, default 2.5
  interval_days: number;   // current interval in days
  repetitions: number;     // consecutive successful reviews
  next_due_at: number;     // unix ms
  last_reviewed_at?: number | null;
}

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure SM-2 step. Returns the new card state given the user's rating.
 * Does NOT touch the database — the caller decides whether/when to persist.
 */
export function nextDue(card: SrCardState, rating: Rating, now: number = Date.now()): SrCardState {
  let { ease_factor, interval_days, repetitions } = card;

  if (rating === 1) {
    // Lapse: reset, drop ease.
    repetitions = 0;
    interval_days = 1;
    ease_factor = Math.max(MIN_EASE, ease_factor - 0.2);
  } else {
    // Map rating → SM-2 quality (q in [3..5]).
    // 2=hard→3, 3=good→4, 4=easy→5
    const q = rating === 2 ? 3 : rating === 3 ? 4 : 5;

    // EF update per SM-2 formula.
    ease_factor = Math.max(
      MIN_EASE,
      ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    );

    repetitions += 1;
    if (repetitions === 1) {
      interval_days = 1;
    } else if (repetitions === 2) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    if (rating === 4) {
      // "Easy" gets a small extra bonus.
      interval_days = Math.max(interval_days, Math.round(interval_days * 1.3));
    }
  }

  const next_due_at = now + interval_days * DAY_MS;
  return {
    ...card,
    ease_factor,
    interval_days,
    repetitions,
    next_due_at,
    last_reviewed_at: now,
  };
}

/**
 * Persist a review: update `sr_cards` row + append to `sr_review_log`.
 * Runs in a single SQLite transaction. Returns the post-review card state.
 *
 * Throws if `cardId` is unknown.
 */
export function applyReview(
  db: Database.Database,
  cardId: number,
  rating: Rating,
  now: number = Date.now(),
): SrCardState {
  const selectStmt = db.prepare(
    `SELECT id, ease_factor, interval_days, repetitions, next_due_at, last_reviewed_at
       FROM sr_cards WHERE id = ?`,
  );
  const updateStmt = db.prepare(
    `UPDATE sr_cards
        SET ease_factor      = @ease_factor,
            interval_days    = @interval_days,
            repetitions      = @repetitions,
            next_due_at      = @next_due_at,
            last_reviewed_at = @last_reviewed_at
      WHERE id = @id`,
  );
  const logStmt = db.prepare(
    `INSERT INTO sr_review_log (card_id, reviewed_at, rating, interval_days_after)
     VALUES (?, ?, ?, ?)`,
  );

  const tx = db.transaction((cid: number, r: Rating): SrCardState => {
    const row = selectStmt.get(cid) as SrCardState | undefined;
    if (!row) throw new Error(`sr_cards row not found: id=${cid}`);
    const updated = nextDue(row, r, now);
    updateStmt.run({
      id: cid,
      ease_factor: updated.ease_factor,
      interval_days: updated.interval_days,
      repetitions: updated.repetitions,
      next_due_at: updated.next_due_at,
      last_reviewed_at: updated.last_reviewed_at,
    });
    logStmt.run(cid, now, r, updated.interval_days);
    return updated;
  });

  return tx(cardId, rating);
}
