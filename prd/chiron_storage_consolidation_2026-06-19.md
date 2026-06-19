# Chiron Storage Consolidation — Event-Sourced Catalog PRD

**Date:** 2026-06-19
**Status:** DRAFT — design locked via Claude×Gemini paired debate (6 rounds); ready to build the MVP slice.
**Owner:** Gyasi Sutton (solo today; possibly multi-user later — see §7)
**Related:** [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md) (sibling — rich-media ingest), [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) (parent skill design), [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md) (CMS/consumption). Prior art: [`gyasis/CureIQ`](https://github.com/gyasis/CureIQ) (Postgres+pgvector central question bank).

**Delete when:** the MVP slice (`catalog-sync` + `sr-replay` + `sr-due`) ships and the per-lesson `.chiron-state.db` design is formally retired in the spec.

---

## 1. Problem

Chiron's outputs are scattered with no central organization:

- **11 loose lesson directories** (`lesson.html` + `themes/` + `vendor/`).
- **8 `.chiron` ZIP bundles** in the PWA player + a hand-maintained `lessons.json` flat catalog.
- **7 stray `brief.json`** sidecars.
- The spec's per-lesson SQLite `.chiron-state.db` (quiz_attempts, mastery, sr_cards, sr_review_log, bookmarks, …) **is designed but NEVER written** (0 on disk).

Consequences: no central index, no cross-lesson search, **no unified spaced-repetition queue** (each lesson is an SR island), no dedupe (already have `graphiti-implementation` AND `graphiti-implementation-v1`).

## 2. Decision

**Reject** a multimodal vector store (LanceDB/DeepLake) — it is over-engineering for this scale and, critically, solves neither of the goals that matter (see §7: "multimodal" ≠ "multi-user").

**Adopt an event-sourced, three-layer architecture:**

1. **BUNDLES** — immutable `.chiron` ZIPs (content + media), stored on **S3**.
2. **EVENTS** — append-only **JSONL** log, the source of truth for mutable state, synced via **Syncthing**.
3. **CATALOG** — a local, never-synced, **rebuildable SQLite + FTS5** database that is a *materialized view* of bundles + events.

This honors the project's hard rules today (SQLite/JSON not Postgres; single learner; minimal infra) AND keeps clean seams so a future multi-user/shared-web pivot is a **tier-swap, not a rewrite** (§7).

## 3. The three layers (what lives where)

| Layer | Stores | Mutable? | Lives on | Synced via |
|---|---|---|---|---|
| **Bundles** | `.chiron` ZIP per lesson: `manifest.json` + `chapter*.json` + `media/*.{mp3,webp,mp4}` | No — regeneration = new version | **S3** `s3://gyasis-chiron-bundles/` | — (PWA streams over HTTP/CDN) |
| **Events** | review / bookmark / chapter-complete / weakness events, one JSONL file per device | append-only | local files (`events/<yyyy-mm>-<device>.jsonl`) | **Syncthing** (tiny, conflict-free) |
| **Registry** | `bundles.jsonl` — which bundle IDs exist + their S3 hash/key | append | local files | **Syncthing** (so each device knows what to pull) |
| **Catalog** | `catalog.db` — bundle-derived index + event-derived SR state + FTS5 | derived | local | **never synced — rebuilt on demand** |

**Why this split:** never sync a live SQLite file (corruption via WAL/mid-write copy/split-brain). Sync only immutable bundles + append-only events; derive the DB locally. Spaced repetition is **path-dependent** (each review mutates ease/interval from the prior state), so state MUST be replayed in timestamp order through the existing scheduler — never last-write-wins on a scalar.

## 4. Schema (valid SQLite AND Postgres — via Drizzle ORM)

### Bundle-derived (static; populated by scanning `.chiron`)
```sql
CREATE TABLE bundles  (id TEXT PRIMARY KEY, title TEXT, domain TEXT, version TEXT,
                       hash TEXT, s3_key TEXT, size_mb REAL, created_at INTEGER, meta TEXT /*JSON*/);
CREATE TABLE chapters (id TEXT PRIMARY KEY, bundle_id TEXT, title TEXT, sort_order INTEGER);
CREATE TABLE cards    (id TEXT PRIMARY KEY,          -- <concept_id>:<ordinal>  (see §5)
                       bundle_id TEXT, chapter_id TEXT, concept_id TEXT,
                       card_type TEXT,               -- cloze|term-def|vignette|fill-blank|mechanism|
                                                     -- dose-fact|vocab|conjugation|code-output|code-bug|methodology
                       front TEXT, back TEXT, media_ref TEXT, tags TEXT /*JSON*/, meta TEXT /*JSON*/);
CREATE VIRTUAL TABLE cards_fts USING fts5(front, back, tags, content='cards', content_rowid='rowid');
CREATE TABLE card_tags (card_id TEXT, key TEXT, value TEXT);   -- queryable domain facets
```

### Event-derived (materialized by replaying events through `lib/sr-scheduler.ts` `nextDue()`)
```sql
-- Columns aligned EXACTLY to SrCardState (SM-2, NOT FSRS):
CREATE TABLE sr_cards (card_id TEXT PRIMARY KEY, ease_factor REAL DEFAULT 2.5,
                       interval_days INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0,
                       next_due_at INTEGER, last_reviewed_at INTEGER);
CREATE TABLE bookmarks          (card_id TEXT PRIMARY KEY, created_at INTEGER);
CREATE TABLE chapter_completion (chapter_id TEXT PRIMARY KEY, completed_at INTEGER);
CREATE TABLE tombstone_events   (card_id TEXT, raw TEXT);  -- events for cards not in current bundles
```

### Event JSONL schema
```jsonc
{"t":"rev","cid":"klinefelter:hypogonadism:01","r":3,"ts":1718800000000,"dev":"linux"}  // review (r=1..4)
{"t":"bmk","cid":"klinefelter:hypogonadism:01","val":true,"ts":...}                      // bookmark
{"t":"cmp","chid":"klinefelter:ch03","ts":...}                                          // chapter complete
{"t":"wk","cid":"...","ts":...}                                                         // weakness flag
```
Replay rule: per card, fold its `rev` events in `ts` order through `nextDue(state, rating, ts)`; `sr_cards` is the output. Multi-device offline double-review is well-defined (the 2nd review operates on the state the 1st produced; slight over-scheduling self-heals next review).

## 5. Card-ID stability (the critical correctness item — verified against code)

SR history is keyed by `card_id`; if a lesson is regenerated the id must NOT change or history orphans. **Verified in chiron's code (2026-06-19):**
- Concept DAG nodes (`concepts/*.json`) have **stable, curated, version-pinned ids** (`values-and-types`, `hypogonadism`, …) — NOT LLM-derived per run. ✅
- Every SR card **already requires `concept_id`** drawn from the chapter's `keyConcepts` (`prompts/04n-sr-card-gen.md`). ✅
- Chapters carry `chapterId`. ✅
- BUT card-level `id` is currently `z.string().optional()` and several cards share a `concept_id`, so `concept_id` alone is not unique per card. ⚠️

**Resolution:** `card_id = <concept_id>:<ordinal-or-slug>`, anchored on the stable concept id (survives typo-fixes AND restructuring — what `md5(front)` got wrong). The generator MUST emit a deterministic per-card ordinal/slug into the manifest. Content-hash is a fallback only for bundles authored without it. **Bonus:** because concept ids are global/curated, the same concept reviewed in two different lessons shares SR lineage → cross-lesson mastery for free. Deleted cards' events go to `tombstone_events` so a restored card regains history. **No `card_lineage` table** (cut as a maintenance trap).

## 6. How heterogeneous per-domain layouts are organized

Medicine (clinical vignettes + QUEST-AI + atlas units), language-it (annotated passages + conjugation + vocab), and code (spot-the-bug + code-output) have **entirely different layouts**. The split handles this cleanly:

- **Uniform relational spine in the catalog** — `lesson → chapters → cards (+tags, +SR state, +FTS)`. Every domain reduces to this; it's what gets indexed, searched, scheduled, shared. The catalog never parses a vignette or a conjugation table.
- **Polymorphic layout stays IN the bundle** — all 33 widget types live in the bundle's `chapter*.json` (chiron already models them as a Zod discriminated union). Self-contained; the player renders each.
- **Three variation mechanisms (all portable SQLite↔Postgres):**
  1. `card_type` discriminator — common columns + a type tag (already exists in the schema).
  2. `card_tags` key/value facets — `medical_specialty=cardiology`, `language_submode=passage`, `code_lang=typescript`.
  3. JSON `meta` columns — anything domain-specific you want to query later (USMLE body-system, CEFR level); both engines index JSON.

This is also what powers **Virtual Bundles** — dynamic remedial decks via one SQL query (`all vignette cards tagged cardiology with ease_factor<2.0`), independent of how each lesson renders.

## 7. The multi-user / shared-web future (decision rule)

The single-learner premise may evolve into a platform where many people create + share chirons. Resolved via Round 6 of the debate (Claude + Gemini independently agreed):

**"Multimodal" and "multi-user" are orthogonal.** LanceDB/DeepLake are smart *file formats* for ML/vector workloads with NO concept of users, auth, or row-level access — they serve neither goal. Building sharing on them = writing a database on a database. They are not candidates.

**SQLite is the on-ramp, not a dead-end** — the architecture's seams don't move at the multi-user inflection:
- Bundles on S3 → *identical* (a shared chiron = a public S3 object + a catalog row — that IS the sharing feature).
- Event state → add `user_id` to the event key (per-user streams = how Anki sync works).
- Catalog → the only tier that migrates, and it's a clean lift.

**Decision rule:**
- **NOW:** SQLite **via Drizzle ORM** (neutralizes the FTS5↔`tsvector` dialect gap — swap driver, not queries) + **ULID/UUID ids everywhere** (never auto-increment — so datasets can ever merge).
- **→ Turso/libSQL** (same SQLite engine, hosted+replicated+multi-tenant) WHEN you want one user's progress synced across devices in the cloud.
- **→ Supabase (Postgres + pgvector + RLS + auth + storage)** the moment you build the **social/marketplace layer** (follow creators, fork/rate lessons, public discovery). This is the CureIQ path, proven.

**The one thing to get right now** so the pivot is a tier-swap: content-addressed/ULID bundle ids + `user_id`-namespaced event keys + a schema valid in both SQLite and Postgres. **Note:** going multi-user later requires revising the CLAUDE.md "single learner / SQLite-not-Postgres" rule — this design is compliant TODAY and makes that future cheap.

## 8. Retirements

| Existing | Status |
|---|---|
| per-lesson `.chiron-state.db` (designed, never written) | **RETIRED** — replaced by central event-sourced `catalog.db` |
| hand-maintained `player/lessons/lessons.json` | **REPLACED** by `SELECT * FROM bundles` (and a generated `index.json` for the PWA) |
| `sr_review_log` table | **DEFERRED** — the JSONL event files ARE the review log |

## 9. Build-today slice (pure Node + SQLite + existing code)

1. **`chiron catalog-sync`** — scan `.chiron` bundles (local dir or S3) → populate `bundles/chapters/cards/cards_fts/card_tags`. Reuses the existing ZIP/`fflate` parsing. Replaces `lessons.json`.
2. **`chiron sr-replay`** — read all `events/*.jsonl`, sort by `ts`, fold each card's `rev` events through the **existing** `lib/sr-scheduler.ts` `nextDue()` → materialize `sr_cards`. Wrap in one transaction.
3. **`chiron sr-due`** — `SELECT … FROM sr_cards JOIN cards … WHERE next_due_at <= now ORDER BY next_due_at` = the unified cross-lesson queue (the #1 win).
4. **Player tweak** — append events to the JSONL log instead of writing a per-lesson DB.

**Cut from MVP:** `card_lineage`, snapshotting (only needed past ~10k events), vector/`sqlite-vec` (FTS5 over existing transcripts/text suffices). **Adopt now (cheap, high-leverage):** Drizzle ORM + ULIDs.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Concept-DAG id drift if a DAG file is re-curated | DAG files are version-pinned + human-owned (already true); changing one is a deliberate, rare act |
| Replay slow at ~10k+ events | snapshot every N events (deferred; <200ms for 50k on modern hardware in one txn) |
| Clock skew (Mac vs Linux) reorders events | sort by `ts`; clamp `sr-due` to `min(now, last_event_ts)`; SM-2 self-heals minor skew |
| "Ghost bundle" (S3 bundle present, catalog row missing on another device) | `bundles.jsonl` registry synced via Syncthing + a "refresh catalog" scan |
| SQLite→Postgres dialect gap (FTS5 vs tsvector, JSON, dates) | Drizzle ORM from day one — swap the driver, not the queries |
| Virtual-Bundle media pathing (cross-bundle decks) | a media resolver mapping `media/x.mp3` → its origin bundle's S3 key |

## 11. Resolved decisions (2026-06-19)

1. **Bundle storage:** **local dir + Syncthing first** (`~/chiron/bundles/`), S3 later when PWA-hosting/sharing is real. Design unchanged either way.
2. **Drizzle:** **YES, now** (drizzle-orm 0.45.2, drives the existing better-sqlite3). Cheapest multi-user insurance — neutralizes the SQLite↔Postgres dialect gap.
3. **Generator card-IDs:** **YES, fold in.** Stage-4 card-gen emits stable `<concept_id>:<ordinal>` slugs into the manifest as part of this work (Tier 1 below).

## 12. Migration & legacy fallback (consolidation = the FIRST build step)

**Decisive fact (verified 2026-06-19): there are 0 `.chiron-state.db` files — NO legacy SR history exists.** So legacy cards need only a *deterministic, collision-free* id, not a *lineage-stable* one. Stable concept-based ids only need to matter GOING FORWARD. This dissolves the hard part of the card-ID problem for migration.

**Gather into one location (`chiron catalog-sync` step 0):**
1. Normalize everything to `.chiron` bundles in `~/chiron/bundles/` (Syncthing-synced): copy the 8 player bundles; zip each of the 11 loose `lessons/*/` dirs (already self-contained: lesson.html+themes+vendor) into a `.chiron`.
2. Dedupe SURFACING (hash + title similarity, e.g. `graphiti-implementation` vs `-v1`) — shown to the user, never auto-deleted.
3. Emit `bundles.jsonl` registry.

**Card-ID fallback ladder (catalog-sync must handle all three + two bundle layouts):**
| Tier | Source | card_id strategy |
|---|---|---|
| 1 | NEW lessons (post-generator-update) | `<concept_id>:<ordinal>` — stable, cross-lesson-shareable |
| 2 | legacy bundles WITH structured srCards (the 3 medicine; `chapter*.json`) — note: their srCards currently lack `concept_id` | `<bundle_id>:<chapterId>:<ordinal>` (deterministic; bundle-scoped); SR starts fresh |
| 3 | loose-HTML lessons + Italian bundles (`chiron.json`, no structured cards) | **catalog at LESSON level** (searchable/openable); SR cards created only on regeneration |

**Two bundle layouts to parse:** `chapter*.json` (medicine) AND `chiron.json` single-content (Italian/older). catalog-sync detects and handles both.

---

*Generated 2026-06-19 from a 6-round Claude×Gemini paired debate. Architecture verified against chiron's actual `sr-scheduler.ts`, `concepts/*.json`, `prompts/04n-sr-card-gen.md`, and a live `.chiron` manifest.*
