# Chiron Assessment Engine — Stable-Question Tiered Dynamicity PRD

**Date:** 2026-06-19
**Status:** DRAFT — design locked via Claude×Gemini paired debate (2 rounds, full convergence). Build Tier 1+2 next.
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_storage_consolidation_2026-06-19.md`](./chiron_storage_consolidation_2026-06-19.md) (the catalog + cross-lesson SR this builds on), [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md). **Separate track:** CureIQ-as-question-MCP-backend → `CureIQ/prd/cureiq_question_mcp_backend_2026-06-19.md` (the multi-user shared bank this engine calls LATER).

**Delete when:** Tier 1 + Tier 2 ship and the lesson player consumes the dynamic queue.

---

## 1. Problem

chiron has **zero dynamicity**: a lesson's quiz questions are static, baked once at lesson-build, seen once. There is no runtime variation, no "don't show the exact same card twice", no pulling related questions from other lessons. Evaluation is effectively stateless (the per-lesson `.chiron-state.db` was never written; the storage PRD just built the catalog + event-sourced cross-lesson SR to fix the state side).

## 2. Three concerns kept SEPARATE (the user's framing — do not violate)

1. **The lesson** — content.
2. **Lesson-bound questions** — source-grounded, authored *with* the lesson; **they stay with the lesson, never stripped into a central-only store.**
3. **Pure quiz generation** — its own domain, *informed by* lessons but separate (the CureIQ track).

The new capability wanted = **dynamicity**, ADDITIVE to (2): vary a lesson's internal questions + surface similar questions, at runtime, without losing source-grounding or SR integrity.

## 3. Decision

**Stable-Question Tiered Engine.** SR binds to the **stable question** (`card_id = <concept_id>:<ordinal>`, from the storage PRD), NOT the concept — concept-level SR was rejected (difficulty drift: an easy grounded Q then a hard generated Q reschedules the concept meaninglessly). Dynamicity is a **presentation + local-search layer**, not an LLM-generation-by-default layer. CureIQ-Postgres is NOT a dependency for solo (deferred to the multi-user track).

## 4. The 3-tier dynamicity ladder

| Tier | What it does | Cost | Safety | Engine (solo) |
|---|---|---|---|---|
| **1 — Hydration** | **Meaning-preserving transforms ONLY**: MCQ option-shuffle (repoint the correct-answer index), card/section reordering. **NOT** numeric/synonym swap — that mutates content (a changed lab value changes the medicine). | free, no LLM, offline | safe — re-skins an already-verified question | local TS util over `cards` |
| **2 — Cross-pollinate** | Pull *already-verified* similar questions from OTHER lessons sharing the `concept_id`. No generation, no hallucination. | cheap, offline | safe — pre-verified | catalog **FTS5** (already built) |
| **3 — Gated synthesis** | True-new question generation, **QUEST-AI-verified at generation**, then **pinned** with a stable id → enters SR normally. Lazy (only when a stable question is over-exposed or a concept is "lonely"). | LLM | safe only if gated | existing `04b/04c/...` quiz prompts + a pin step |

**Tier 1 is the backbone** — it breaks visual/positional memorization (the "answer is the longest option / always C" habit) at zero cost, delivering ~90% of the felt dynamicity. Tier 3 is the rare last resort.

## 5. Medicine safety line (BLOCKING)

- **Graded** medicine assessment = **Tiers 1–2 only** (verified content; deterministic grading).
- **Tier 3 for medicine** is allowed **only at generation time behind the existing QUEST-AI verifier loop** (the same gate lesson-build uses), then pinned. NEVER runtime-graded JIT.
- Low-risk domains (code, language vocab) may use runtime/ungraded Tier-3 "practice" freely.
- A generated variant that is shown must carry a **grounding proof** (the source snippet it used), surfaced after answering.

## 6. SR integrity (the resolved tension)

Dynamic/ephemeral questions vs SR's need for stable identity → **SR tracks the stable question, presentation varies.** Each `card_id` keeps its own SM-2 row (storage PRD). Tier 1 varies the *surface* of the same `card_id` (same SR unit). Tier 2 surfaces a *different* stable card (its own SR unit). Tier 3 *pins* a new stable card before it enters SR. No tier ever schedules an un-identified question.

## 7. Build slice (no CureIQ, no Postgres)

1. **Tier 1** — `lib/catalog/hydrate.ts`: `hydrate(card)` → deterministically shuffle MCQ options + repoint the answer (seeded by review count so it varies per exposure but is reproducible). Pure, tested, offline.
2. **Tier 2** — `lib/catalog/similar.ts`: `similar(cardId)` → FTS5/`concept_id` query for verified sibling questions across lessons (catalog already has FTS5 + `concept_id`).
3. **Tier 3** — `pinGenerated(card)`: reuse the `04b/04c/...` prompts (agent-driven) + insert a new `cards` row with a stable id + (medicine) QUEST-AI gate. Lazy trigger: over-exposure or lonely-concept.
4. **Session glue** — `nextQuestion(dueCard)`: due card (from the SR queue we built) → Tier 1 reskin by default; Tier 2 sibling for variety; Tier 3 only when warranted.

## 8. Scenarios

| # | Scenario | Tier | Outcome |
|---|---|---|---|
| 1 | Card seen 10× | 1 | options reshuffled, difficulty identical, memorization broken |
| 2 | Lonely concept (1 Q, no siblings) | 3 (lazy) | generate + QUEST-AI verify + pin → 2 stable Qs |
| 3 | Medicine mock exam | 1–2 only | 100% verified, deterministic grade |
| 4 | Code practice | 3 ungraded | infinite low-risk variety |
| 5 | Offline flight | 1–2 | fully functional, no LLM |
| 6 | Cold-start library (1 lesson) | 1 | Tier-2 finds nothing → Tier-1 still gives variety |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Tier-1 "synonym/numeric swap" silently mutates medical content | EXCLUDED from Tier 1 — only meaning-preserving transforms (PRD §4) |
| Tier-3 hallucination in medicine | QUEST-AI gate at generation; never runtime-graded; grounding proof shown |
| Cross-pollinated sibling is off-tone/off-topic | rank by FTS score + same `concept_id`; cap; user can flag |
| Tier-3 cost/bloat | lazy generation only; Tier 1 (free) is the default; cap shadow variants per concept |

## 10. The CureIQ boundary (separate track)

For SOLO, CureIQ is NOT touched — Tiers 1–3 run on the local catalog + existing prompts. CureIQ becomes relevant only at the **multi-user inflection**: it is the **shared question-gen + bank, exposed as MCP**, that chiron's Tier 2/3 *calls* — your verified Tier-3 questions sync up; others pull them as Tier-2 cross-pollination. That work is its own development track: `CureIQ/prd/cureiq_question_mcp_backend_2026-06-19.md`. This PRD does not depend on it.

---

*Generated 2026-06-19 from a Claude×Gemini paired debate (full convergence). Builds on the storage-consolidation catalog + cross-lesson SR.*
