# Chiron Lesson Scope & Content Reuse — Scope-Dial + Inherited Foundations PRD

**Date:** 2026-06-24
**Status:** DRAFT — captured from a design conversation (ssm_essame session). Design not yet locked; build after the storage + assessment engines land.
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_storage_consolidation_2026-06-19.md`](./chiron_storage_consolidation_2026-06-19.md) (the catalog DB this reuses), [`chiron_assessment_engine_2026-06-19.md`](./chiron_assessment_engine_2026-06-19.md) (the Tier-1/2 reuse primitives `hydrate.ts` + `similar.ts`), [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md). Working note: [`../skill/docs/LESSON-SCOPE-AND-REUSE.md`](../skill/docs/LESSON-SCOPE-AND-REUSE.md). Node spine: **a pluggable disease taxonomy** (system → class → disease), supplied as a generic input — chiron stays domain-general and never hardcodes any particular exam or curriculum.

**Delete when:** the `scope` knob ships AND a disease deep-dive inherits a class-owned Foundations block AND the REPEAT/PULL/CITE policy runs at generation time.

---

## 1. Problem

A chiron lesson today is generated at exactly one altitude — a flat single-topic lesson — and each lesson is authored **in isolation**. Two consequences:

1. **No scope choice.** You can ask for "acute pericarditis" but not for "pericardial disease" as a *class survey* that shows the disease among its siblings. A disease taxonomy (system → class → disease), supplied as input, has no representation in generation.
2. **Chiron repeats itself.** If an "acute pericarditis" deep-dive exists and you then build a "pericardial disease" class lesson, the shared anatomy / pathophysiology / biochemistry / epidemiology is **re-authored from scratch** — wasted generation, and the two lessons can silently drift apart. The same applies across domains (a medical fact re-authored for the medicine×Italian lesson).

The storage + assessment PRDs already built a cross-lesson catalog with stable IDs, FTS, concept linkage, cross-bundle `similar()`, and reskin-on-reuse `hydrate()`. This PRD **uses that substrate** to add scope + author-once content, instead of letting overlapping lessons duplicate work.

## 2. Framing (kept consistent with the assessment-engine PRD §2)

The assessment PRD separated *lesson content* / *lesson-bound questions* / *pure quiz gen*. This PRD operates on **lesson content** (and the Foundations narrative layer), and on the **generation-time decision** of whether to author, inherit, or link a content unit. It does not change the SR/question-identity rules.

## 3. Decision — one model, two faces (the union, not two ideas)

### 3a. Scope dial

A lesson is generated against a **node in the disease taxonomy**; the node's level sets the genre:

| `scope` | Keyed to | Genre | Behavior |
|---|---|---|---|
| `system` | a body system | broadest survey | systems map; classes are the units |
| `class` | a taxonomy class ("Pericardial Disease") | **class survey** | class appears once; all members (acute / constrictive / effusion-tamponade / recurrent) surface together — **shared** mechanism + **contrasts**. Breadth. |
| `disease` | one disease ("Acute Pericarditis") | **deep-dive / UpToDate-style monograph** | exhaustive single-entity reference. Depth. |

Implemented as a curriculum knob, mirroring the existing `subMode: medicine-amboss | medicine-uptodate` pattern (`scope` on `TriggerContext`).

### 3b. Foundations block (the missing dimension) — class-owned, progressively deep

The AMBOSS skeleton is clinical-reasoning-first and omits the basic-science scaffold:
**anatomy · pathophysiology · biochemistry/molecular · epidemiology.** These live as a
dedicated **"Foundations — Background & Deep Dive"** block: collapsible, reference-style,
not diluting the active-recall flow.

- **Progressive depth / "learn more".** Pathophysiology and biochemistry are a **deep
  layer**, not a flat paragraph. Foundations shows a *summary first* with an explicit
  **"learn more"** drill into the deep mechanism (molecular cascade, pressure-volume curves,
  mediator pathways). Learner picks the depth: skim for board recall, expand for mastery.
- **Owned by the class, inherited by the disease.** The pericardium's anatomy/pathophys is
  authored **once** at the class node; every pericardial disease deep-dive **pulls it in** as
  its Foundations section and adds only disease-specific specifics. No 5× rewrite; survey and
  deep-dive can't drift.

## 4. The reuse policy — REPEAT / PULL / CITE / HYDRATE (generation-time, per content unit)

When a lesson overlaps content that already exists (class lesson, sibling disease, or another domain):

| Decision | When | Effect |
|---|---|---|
| **REPEAT** (regenerate) | small + central to *this* lesson's flow (e.g. the headline vignette) | author fresh; store as a new stable id |
| **PULL** (inherit) | shared foundational content the class owns (anatomy, pathophys) | embed the class-owned block by reference; one source of truth |
| **CITE** (link) | a full *other* lesson / deep tangent | link out ("see the Acute Pericarditis deep-dive"); don't inline |
| **HYDRATE** (reuse + reskin) | a verified assessment card applies here too | reuse the same `card_id`, reskin via `hydrate.ts` (assessment PRD Tier 1) |

Default bias: **PULL/CITE shared content; REPEAT only what is local-and-central.** DRY-for-lessons.

### Cross-domain reuse (the Italian case)

A clinical fact tagged with a `concept_id` is domain-neutral. The medicine×Italian lesson
(`/chiron-medical-ward`, Lucrezia persona) **PULLs** it and re-presents it as a simple,
board-style MCQ that teaches the medical subject **and** Italian at once — one verified fact,
two domains, no re-verification. Uses the catalog's existing cross-bundle `similar()` over
`concept_id` (domain-agnostic) + `bundles.domain`.

## 5. Readiness — substrate ~80% built (`lib/catalog/`)

| Asked-for capability | Already exists | Gap |
|---|---|---|
| Central multi-lesson content store | `catalog/db.ts` (Drizzle SQLite → Postgres-liftable): `bundles/chapters/cards/card_tags` + FTS5 | unit is the **card**; need a unit for **narrative Foundations blocks** |
| Author-once stable IDs | `cards.id` ladder + `idx_cards_concept` | extend ID scheme to foundations/exposition blocks |
| Pull verified content from other lessons | `catalog/similar.ts` (`byConcept` + FTS `byText`, cross-bundle) | exists; need REPEAT/PULL/CITE *policy* at gen time |
| Reuse without stale repetition | `catalog/hydrate.ts` (seeded option-shuffle reskin) | ready as-is |
| Cross-domain reuse | `bundles.domain` + domain-neutral `concept_id` | wire the Italian PULL path |
| Scope = system/class/disease | — | **not built**: no `scope` knob; taxonomy not the spine |

**Verdict: well poised.** The hard part (stable-ID cross-lesson catalog + cross-bundle
similarity + FTS + concept linkage + reskin) is done. Remaining work is orchestration +
a small schema add, not new substrate.

## 6. Build slice

1. **`scope` knob** — add `scope: system|class|disease` to `TriggerContext` + curriculum; Stage 1/2 route on it. (pipeline/prompt)
2. **Foundations block** — new chapter/section type (anatomy/pathophys/biochem/epi) with a summary + "learn more" progressive-depth drill. (prompt + renderer)
3. **Foundations as a reusable unit** — extend the catalog so a Foundations/exposition block is a stable, addressable, class-owned content unit (not only `cards`). (schema add)
4. **REPEAT/PULL/CITE policy** — generation-time decision per content unit (§4 table), defaulting to PULL/CITE for shared content. (pipeline)
5. **Class→disease inheritance** — a disease deep-dive PULLs the class's Foundations block. (pipeline)
6. **Taxonomy binding** — bind generation to a **pluggable disease taxonomy** (system→class→disease) as the node spine, supplied as a generic input; decide canonical-vs-mirror (see §7 Q1). No exam/curriculum is hardcoded. (integration)
7. **Cross-domain PULL** — medicine → medicine×Italian Foundations/fact reuse via `concept_id`. (pipeline)

## 7. Open questions

1. Does chiron consume an **external taxonomy** as the canonical node spine, or **mirror/import** it into its own catalog (versioned)? Either way the taxonomy is a generic, swappable input — not a built-in.
2. Similarity threshold for PULL-vs-REPEAT — automatic, or author judgment?
3. Does a disease deep-dive **embed** the class Foundations inline, or **link + summarize**?
4. Does `scope: class` **compose upward** from members' existing deep-dive units, or author class-level content fresh and let diseases **inherit downward**?

## 8. Risks

| Risk | Mitigation |
|---|---|
| Foundations block bloats the lesson / breaks AMBOSS rhythm | collapsible + summary-first; "learn more" is opt-in depth |
| PULL stale content after the source unit changes | content-hash the unit (catalog `bundles.hash` pattern); re-pull on change |
| Over-aggressive PULL strips a lesson of self-containedness | default REPEAT for local-and-central units; CITE (not silent omit) for tangents |
| Taxonomy coupling — external taxonomy schema drift breaks chiron | treat the taxonomy as a generic, versioned input (never hardcoded); resolve §7 Q1 first; if mirror, version the import |

---

*Captured 2026-06-24. Builds directly on the storage-consolidation catalog + assessment-engine reuse primitives. Node spine: a pluggable disease taxonomy supplied as a generic input — chiron stays domain-general and hardcodes no exam or curriculum.*
