# Chiron Lesson Expander — Design PRD

**Date:** 2026-05-12
**Status:** DRAFT — first feature under the [Generator Enhancements umbrella](./chiron_generator_cureiq_synthesis_2026-05-12.md); first to build (Phase GP1)
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md), [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md), [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md), prior art: `gyasis/CureIQ` `data_processing/MCQA_generator.py`

**Delete when:** Expander has run successfully on 3 different real lessons across 2 different domains, with marked-card regeneration loop validated end-to-end.

---

## 1. Executive Summary

**Chiron Lesson Expander adds quiz/SR items to an existing Chiron lesson without regenerating the lesson's chapter prose.** Two invocation modes:

| Mode | Trigger | Use case |
|---|---|---|
| **CLI (manual)** | `/chiron-expand <slug> --count 20 --type clinical-vignette` | "I want 20 more pneumothorax vignettes on my existing lesson" |
| **CMS-driven (automatic)** | CMS surfaces `marked_cards` rows with `mark_type='regenerate'`; expander runs against those marked items' source | "Reviewing on phone, I flag a card as wrong — overnight, generator regenerates that card from source" |

In both modes: the original `lesson.html` is untouched, new cards land in the same lesson's `.chiron-state.db` `sr_cards` table, a new bundle is uploaded to the CMS replacing the old `.chiron-state.db` (per the existing upload semantics that already warn about state replacement).

**Key design constraint:** the expander operates against the **same source(s)** the original lesson used, preserved in `lessons/<slug>/source/` (per `chiron_design_v1` FR-030). No new source needed at expansion time.

---

## 2. Context & Motivation

`chiron_design_v1_2026-04-28.md` §4 locks the requirement that medicine lessons generate **15-20+ vignettes per topic** for pattern recognition. In real use, two things happen:

1. **You exhaust a lesson's pool.** After 2 weeks of reviewing, you've seen each of the 18 vignettes 4-5 times; the pattern-recognition value of any single one is decaying. You want fresh stems on the same disease.
2. **A vignette is wrong / poorly written.** You flag it on your phone (`mark_type='wrong'` via the `marked_cards` table from the server PRD FR-026). Tomorrow, the generator should be able to regenerate that specific card with the same source context.

CureIQ's `MCQA_generator.py` is the prior-art proof that "given a source corpus + a desired output count, emit N additional MCQs" is a clean and bounded LLM workflow. We port that into Chiron's pipeline.

---

## 3. Architectural Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Expander operates from `lessons/<slug>/source/`** — never re-asks the user for source | Source is preserved in the bundle by `chiron_design_v1` FR-030; expansion = re-running quiz generation against same source |
| 2 | **Expander APPENDS to `sr_cards`, never modifies or deletes existing cards** | Preserves SR state for cards user has been reviewing; mark-as-suspended is the way to remove a card, not delete |
| 3 | **The original `lesson.html` is NEVER edited** | Lesson HTML is for *exposition* (chapter prose + base widget set); SR cards are an orthogonal layer stored only in SQLite + surfaced by main.js at runtime. Expander touches only the DB. |
| 4 | **Anti-duplication via embedding-similarity check before insert** | Without dedup, you'll re-generate near-identical vignettes. Each candidate's stem text is embedded (cheap), compared against all existing card embeddings, rejected if cosine similarity >0.92 |
| 5 | **CMS-driven mode is PULL not PUSH** — generator polls CMS for `marked_cards` with `mark_type='regenerate'` | CMS doesn't need to know where the generator is; generator-side daemon (or manual run) decides when to act |
| 6 | **Re-upload after expansion follows existing bundle upload protocol** | Same `/api/upload` endpoint; new bundle replaces old `.chiron-state.db`. **Critical: the existing in-flight SR state for unchanged cards is preserved by the expander before re-bundling** (see FR-008). |
| 7 | **Question-type diversity is enforced via the vignette taxonomy already in `chiron_design_v1` §9a** | When generating 20 new medicine vignettes, the expander MUST cover the vignette taxonomy `[classic_presentation, atypical_presentation, pediatric, elderly, immunocompromised, pregnancy, with_comorbidity, with_complication, drug_induced_phenocopy, mimicker_to_rule_out]`. Avoids generating 20 cards on the same classic presentation. |

---

## 4. The Expander Pipeline (4 stages)

```
STAGE E0: LOAD          → read lessons/<slug>/{manifest.json, .chiron-state.db, source/}
                          → identify existing cards (for dedup) + existing concepts (for coverage gap)
                          
STAGE E1: TARGET        → resolve what to generate:
                          - CLI mode: count + type from flags
                          - CMS mode: marked_cards rows where mark_type IN ('regenerate', 'wrong', 'edit')
                          → list of (concept_id, card_type, count) generation tasks
                          
STAGE E2: GENERATE      → for each task: LLM call producing structured candidate cards
                          → vignette-taxonomy enforcement per chiron_design_v1 §9a
                          → embedding-similarity dedup pass vs existing cards
                          → for medicine: QUEST-AI verifier loop (already locked in §6)
                          
STAGE E3: PERSIST       → INSERT new sr_cards rows (status='new', ease_factor=2.5, interval_days=0, repetitions=0, next_due_at=now)
                          → for replacement-mode (CMS mark_type='regenerate'): mark old card suspended=1 rather than delete
                          → re-zip bundle and POST to CMS /api/upload (existing protocol)
```

Total new code: ~400 LOC TypeScript + 3 new prompt files in `chiron/skill/prompts/expander/`.

---

## 5. Functional Requirements

### Core expansion

- **FR-EX-001** — `/chiron-expand <slug> [options]` CLI invocation. Required arg: slug of an existing lesson. Options: `--count <N>` (default 10), `--type <widget-type>` (default depends on domain), `--concepts <id1,id2,...>` (default: all concepts), `--source <subset>` (default: all sources from manifest).
- **FR-EX-002** — Expander MUST refuse to run if `lessons/<slug>/source/` is missing or empty. Surface specific error: source preservation was added in `chiron_design_v1` FR-030; older lessons without source/ cannot be expanded without manual re-attachment.
- **FR-EX-003** — Expander MUST load every existing card from `sr_cards` to build the dedup pool BEFORE generating any new candidates.
- **FR-EX-004** — For medicine domain with `card_type='clinical-vignette'`, the expander MUST enforce vignette-taxonomy coverage across the requested count — if `--count 20`, at most 4 of the 20 may be `classic_presentation`; the other 16 MUST span the other 9 taxonomy axes.
- **FR-EX-005** — Candidate dedup MUST use embedding similarity (any embedding model in Chiron's `llm_cache` flow — cheap calls). Reject candidate if cosine similarity >0.92 against any existing card; LLM retry up to 3 times per slot.
- **FR-EX-006** — For medicine domain, expander MUST run the QUEST-AI 3-stage verifier loop (Generate → Verify → Refine) per `chiron_design_v1` §3 decision #6.
- **FR-EX-007** — New cards inserted with default SM-2 state (`ease_factor=2.5, interval_days=0, repetitions=0, next_due_at=now()`) — they enter the review queue immediately.
- **FR-EX-008** — Expander MUST NOT modify existing rows in `sr_cards` (no UPDATE, no DELETE) except when explicitly handling `mark_type='regenerate'` — in which case the OLD card is set `suspended=1` and the NEW replacement card is INSERTed.
- **FR-EX-009** — On successful generation, the expander re-zips `lessons/<slug>/` and POSTs to the CMS via the existing `/api/upload` endpoint. CMS responds with `status: 'updated'` and the standard warning that prior SR state was replaced — except for unchanged cards which the expander DID preserve via FR-008.

### CMS-driven mode

- **FR-EX-010** — A `/chiron-expand-marked --cms-url <url> --token <t>` command polls `/api/marked-cards` (NEW endpoint on the CMS — see §8) for any cards where `mark_type IN ('regenerate', 'wrong', 'edit')` across all lessons.
- **FR-EX-011** — For each returned `(slug, card_id, mark_type, notes)`, the expander downloads the corresponding lesson bundle (NEW CMS endpoint `GET /api/lesson/:slug/bundle.zip`, see §8), runs single-card regeneration via FR-005/FR-006/FR-008, re-uploads.
- **FR-EX-012** — After successful regeneration, the expander POSTs `DELETE /api/mark/:slug/:card_id` to clear the mark.
- **FR-EX-013** — `/chiron-expand-marked` MUST batch by lesson (don't download the same bundle twice if 5 cards in the same lesson are marked).

### Provenance and traceability

- **FR-EX-014** — Each new card MUST record in `sr_cards` (or a sibling `sr_cards_provenance` table) the source chunk(s) it was generated from. For RAG-sourced lessons this means the `chunk_id` + page; for PDF-sourced this means the page number; for image-sourced this means the image filename + region bbox if available.
- **FR-EX-015** — Manifest.json's `revision_log` array MUST gain an entry per expansion: `{ when, count_added, mode: 'cli'|'cms-marked', invoker: 'gyasi', git_sha?: '...' }`. Allows audit.

---

## 6. Non-Functional Requirements

- **NFR-EX-001** — Expansion of 20 medicine vignettes against an existing pneumonia lesson completes in <8 minutes wall-clock at default model (Sonnet-4.6).
- **NFR-EX-002** — Expansion cost per 20 vignettes (with verifier loop) ≤ $4.00. Hard-fail at $10.00 with user prompt.
- **NFR-EX-003** — Dedup embedding pass for 100 existing cards completes in <30s.
- **NFR-EX-004** — Expander is idempotent on retry — if invocation crashes after some cards are inserted, re-running with the same args MUST resume from where it left off (track via a small `_expansion_runs` table in the per-lesson DB).
- **NFR-EX-005** — Network-failure resilience — re-upload to CMS retries 3 times with backoff; on permanent failure, expanded cards remain in the local DB and the user is told to upload manually.

---

## 7. User Stories

### CLI mode

- **US-EX-101** — As a med student preparing for boards, I have an existing pneumonia lesson with 18 vignettes I've seen many times. I want to type `/chiron-expand pneumonia --count 20 --type clinical-vignette` and get 20 NEW vignettes covering diverse presentations (pediatric, elderly, immunocompromised, etc.) without losing my existing SR state.
- **US-EX-102** — As a learner, when I expand a lesson, I want to see a per-axis breakdown of what was generated: "Generated 20 vignettes: 4 classic, 3 atypical, 2 pediatric, 2 elderly, 3 immunocompromised, 2 pregnancy, 2 with-comorbidity, 1 mimicker, 1 drug-induced. Cost: $3.42."
- **US-EX-103** — As a code learner, I want `/chiron-expand react-hooks --count 10 --type spot-the-bug` to give me 10 new spot-the-bug exercises against the same codebase the original lesson used.

### CMS-driven mode

- **US-EX-201** — As a learner on my couch, when I see a card with a wrong distractor in the AMBOSS-vignette, I tap a "report" button on the review page. That flags the card with `mark_type='wrong'`.
- **US-EX-202** — As a learner, the next morning my generator-side daemon (or manual `/chiron-expand-marked` run) processes every marked card across all lessons and regenerates them with the same source context.
- **US-EX-203** — As a learner, when a card is regenerated, the old one is suspended (not deleted) so I retain audit trail; the new one enters the queue at default SM-2 state.

---

## 8. Required CMS-Side Changes

These additions to the [server CMS PRD](./chiron_server_cms_2026-05-12.md) MUST be implemented to support the CMS-driven mode (FR-EX-010 through FR-EX-013):

- **CMS-NEW-1** — `GET /api/marked-cards?mark_type=regenerate,wrong,edit` — returns `[{ slug, card_id, mark_type, notes, marked_at }]` aggregated across all per-lesson `marked_cards` tables.
- **CMS-NEW-2** — `GET /api/lesson/:slug/bundle.zip` — re-zips the current `lessons/<slug>/` and streams as zip. Auth required.
- **CMS-NEW-3** — `DELETE /api/mark/:slug/:card_id` — clears the mark (deletes the row from `marked_cards`).
- **CMS-NEW-4** — `POST /api/mark/:slug/:card_id` body `{ mark_type, notes? }` — already specced as FR-026 in server PRD.

These four endpoints are small additions to the existing CMS server (Hono routes, ~80 LOC total).

---

## 9. Buildout Plan (2 days, sequenced)

| Day | Phase | Deliverable |
|---|---|---|
| **D1 morning** | Scaffold + STAGE E0 + E1 | `lib/expander.ts` loads existing cards, parses CLI args, builds task list. Manual smoke test: print "would generate 20 cards covering [taxonomy]". |
| **D1 afternoon** | STAGE E2 (generate + dedup) | LLM generation per task; embedding-similarity dedup against existing cards. Smoke test: generate 5 vignettes against the existing klinefelter lesson, confirm none duplicate. |
| **D2 morning** | STAGE E2 verifier loop + STAGE E3 persist | QUEST-AI verifier wired for medicine; INSERT new cards; manifest.revision_log update. Smoke test: full `/chiron-expand klinefelter --count 5 --type clinical-vignette` produces 5 new cards + updated manifest. |
| **D2 afternoon** | CMS endpoints + CMS-driven mode | Add the 4 CMS endpoints from §8 to the server (if server is built); implement `/chiron-expand-marked`. Smoke test: phone marks 2 cards, expander regenerates both, marks cleared. |

If CMS isn't built yet at the time of expander build, ship CLI mode in D1+D2 morning and defer §8 + CMS-driven mode until server P0.5 ships.

---

## 10. Open Questions

| # | Question | Resolution path |
|---|---|---|
| 1 | What embedding model for dedup? Sentence-transformers locally vs OpenAI ada vs Cohere embed-v3? | D1 — start with `text-embedding-3-small` (OpenAI) for cost and quality; profile against `all-MiniLM-L6-v2` local if cost matters |
| 2 | When a card is regenerated under `mark_type='wrong'`, do we keep the old one suspended (audit trail) or delete it (clean)? | Decision in §3 #5: suspended. Validate during D2. |
| 3 | What's the right embedding-similarity threshold for dedup? 0.92 is a guess. | D1 afternoon — generate 50 candidates against an existing 18-card lesson, manually classify duplicates vs novel, tune threshold |
| 4 | Should expansion be allowed across mixed sources (e.g., expand a lesson originally PDF-sourced using a NEW image source)? | Out of scope for v1. v1 = same source only. |
| 5 | Does the expander need its own cost-cap separate from `chiron_design_v1`'s $25 per-course budget? | Yes — see NFR-EX-002 hard fail at $10. |
| 6 | For language domains, does "expand 20 more fill-blanks" need vocab-coverage analysis? | Yes — same idea as medicine taxonomy: enforce coverage of new vocab axes (declension, tense, modal usage, etc.) per `chiron_design_v1` §4 |

---

## 11. Decisions Log

| Time | Decision | Rationale |
|---|---|---|
| 2026-05-12 | Lesson expander is its own PRD (this file) | High user demand, focused scope, can ship before the broader generator-enhancements roadmap completes |
| 2026-05-12 | Two modes: CLI and CMS-driven | Manual for power use; CMS-driven for the natural "flag-then-regenerate" loop from phone reviews |
| 2026-05-12 | Lesson HTML is never modified by the expander | Preserves the self-contained portable artifact property; SR cards are an orthogonal layer |
| 2026-05-12 | Dedup via embedding similarity, threshold 0.92, tunable | Cheap, captures near-duplicates the LLM produces naturally |
| 2026-05-12 | Vignette-taxonomy coverage enforced per medicine expansion | Same enforcement as initial lesson generation per `chiron_design_v1` §9a |
| 2026-05-12 | Source must be preserved in `lessons/<slug>/source/` (FR-030) for expansion to work | If source isn't preserved, expansion is impossible without re-attaching; surface a specific error |
| 2026-05-12 | Old cards regenerated via `mark_type='regenerate'` are SUSPENDED, not deleted | Audit trail + lets user un-suspend if they decide the regeneration is worse than the original |

---

## 12. References

- [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md) — umbrella PRD this PRD is the first sub-feature of (Phase GP1)
- [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) — parent skill design (§9a vignette taxonomy, §3 decision #6 QUEST-AI verifier, FR-030 source preservation)
- [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md) — sibling server PRD (FR-026 `marked_cards`, §8 the four new CMS endpoints required by this expander)
- [`universal_lesson_generator_2026-04-28.md`](./universal_lesson_generator_2026-04-28.md) — project tracking PRD (index of all PRDs)
- [`gyasis/CureIQ`](https://github.com/gyasis/CureIQ) — prior art:
  - `data_processing/MCQA_generator.py` — concrete reference for "given a corpus, generate N MCQs" pattern
  - `data_processing/MCQA_processor.py` — post-pass to clean, ID, and persist generated MCQs

---

## 13. Speckit Handoff

This PRD is sized for a single `/speckit-specify` invocation. After TTS fix + server CMS P0.5 ships:

```
/speckit-specify  # ingest this PRD as the feature spec
/speckit-clarify  # surface ambiguities (likely: embedding model choice, threshold, error UX)
/speckit-plan     # generate plan.md from the 4-stage pipeline + buildout plan in §9
/speckit-tasks    # generate tasks.md ordered by §9 day-by-day breakdown
/speckit-implement # execute against the tasks
```

Predicted clarification questions speckit will surface:
- "Which embedding model for FR-EX-005?" → answer in §10 OQ 1
- "What happens if QUEST-AI fails for medicine after 3 attempts?" → hard fail, no card inserted, log to llm_usage
- "Is there a UI affordance for triggering CMS-driven mode, or is it strictly CLI?" → CLI-triggered for v1, defer UI to v2

Pre-bake these answers into a `clarifications.md` if speckit prompts for them.
