/**
 * Chiron catalog — SR replay + due query (storage-consolidation PRD §9).
 *
 * `replay` folds the append-only JSONL event log through the EXISTING pure SM-2
 * scheduler (lib/sr-scheduler.ts nextDue) per card, in timestamp order, and
 * materializes the sr_cards / bookmarks / chapter_completion tables. Events for
 * cards not in the current catalog go to tombstone_events (PRD §5).
 *
 * `due` is the unified cross-lesson queue: all cards due now, across every lesson.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextDue, type SrCardState, type Rating } from '../sr-scheduler.js';
import type { Catalog } from './db.js';

interface Ev { t: string; cid?: string; chid?: string; r?: number; val?: boolean; ts: number; dev?: string }

export function replay(cat: Catalog, eventsDir: string): { events: number; cards: number; tombstoned: number } {
  const raw = cat.raw;
  const known = new Set<string>((raw.prepare('SELECT id FROM cards').all() as Array<{ id: string }>).map((r) => r.id));

  const evs: Ev[] = [];
  if (existsSync(eventsDir)) {
    for (const f of readdirSync(eventsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(eventsDir, f), 'utf8').split('\n')) {
        const s = line.trim(); if (!s) continue;
        try { evs.push(JSON.parse(s) as Ev); } catch { /* skip malformed */ }
      }
    }
  }
  evs.sort((a, b) => a.ts - b.ts); // global ts order; per-card fold is order-correct

  const state = new Map<string, SrCardState>();
  let tombstoned = 0;
  const tomb = raw.prepare('INSERT INTO tombstone_events (card_id, raw) VALUES (?,?)');

  raw.exec('DELETE FROM sr_cards; DELETE FROM bookmarks; DELETE FROM chapter_completion; DELETE FROM tombstone_events;');
  const run = raw.transaction(() => {
    const insBmk = raw.prepare('INSERT OR REPLACE INTO bookmarks (card_id, created_at) VALUES (?,?)');
    const delBmk = raw.prepare('DELETE FROM bookmarks WHERE card_id=?');
    const insCmp = raw.prepare('INSERT OR REPLACE INTO chapter_completion (chapter_id, completed_at) VALUES (?,?)');
    for (const e of evs) {
      if (e.t === 'rev' && e.cid) {
        if (!known.has(e.cid)) { tomb.run(e.cid, JSON.stringify(e)); tombstoned++; continue; }
        const prev: SrCardState = state.get(e.cid) ?? { ease_factor: 2.5, interval_days: 0, repetitions: 0, next_due_at: e.ts };
        state.set(e.cid, nextDue(prev, (e.r as Rating) ?? 3, e.ts));
      } else if (e.t === 'bmk' && e.cid) {
        if (e.val === false) delBmk.run(e.cid); else insBmk.run(e.cid, e.ts);
      } else if (e.t === 'cmp' && e.chid) {
        insCmp.run(e.chid, e.ts);
      }
    }
    const insSr = raw.prepare(`INSERT OR REPLACE INTO sr_cards
      (card_id,ease_factor,interval_days,repetitions,next_due_at,last_reviewed_at) VALUES (?,?,?,?,?,?)`);
    for (const [cid, s] of state) insSr.run(cid, s.ease_factor, s.interval_days, s.repetitions, s.next_due_at, s.last_reviewed_at ?? null);
  });
  run();
  return { events: evs.length, cards: state.size, tombstoned };
}

export interface DueCard { card_id: string; front: string; bundle_id: string; domain: string; next_due_at: number; }

export function due(cat: Catalog, now: number = Date.now(), limit = 50): DueCard[] {
  return cat.raw.prepare(`
    SELECT s.card_id, c.front, c.bundle_id, b.domain, s.next_due_at
      FROM sr_cards s JOIN cards c ON c.id = s.card_id JOIN bundles b ON b.id = c.bundle_id
     WHERE s.next_due_at <= ? ORDER BY s.next_due_at ASC LIMIT ?`).all(now, limit) as DueCard[];
}
