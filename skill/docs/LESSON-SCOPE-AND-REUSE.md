# Chiron — Lesson Scope & Content Reuse (design note)

> Origin: 2026-06-24 design session. Captured from a design conversation while
> exploring how chiron would teach a single disease (acute pericarditis) vs its disease
> *class* (pericardial disease). Status: **design note / not yet built.**
>
> **CANONICAL SPEC:** [`../prd/chiron_lesson_scope_and_reuse_2026-06-24.md`](../prd/chiron_lesson_scope_and_reuse_2026-06-24.md)
> — this file is the working note; the PRD is the source of truth (and tracks the GitHub
> issues). Builds on the `storage-consolidation` PRD (`lib/catalog/` DB) and
> `assessment-engine` PRD (`lib/catalog/similar.ts` + `hydrate.ts`).

This note codifies **one model with two faces** (the union, not two separate ideas):

1. A **scope dial** — the same lesson factory generates at different altitudes.
2. **Author-once / reference-everywhere content** — so chiron never repeats itself
   across overlapping lessons; it *pulls* or *cites* instead.

---

## 1. The scope dial

A lesson is generated against a **node in a disease taxonomy** (a 3-level taxonomy
supplied as a generic, pluggable input: system → class → disease). The node's level sets the lesson genre:

| `scope` | Keyed to | Genre | Behavior |
|---|---|---|---|
| `system` | a body system | broadest survey | systems-level map; classes as the units |
| `class` | a taxonomy *class* (e.g. "Pericardial Disease") | **class survey** | the class appears once; all member diseases (acute pericarditis, constrictive, effusion/tamponade, recurrent) surface together — **shared** anatomy/mechanism + **contrasts** between siblings. Breadth. |
| `disease` | one disease (e.g. "Acute Pericarditis") | **deep-dive / UpToDate-style monograph** | exhaustive single-entity reference, every section. Depth. |

Same engine, one parameter. The class node generates the survey; the disease node
generates the deep-dive. A learner drills **class → disease** with a consistent
through-line because both read from the same content store (§3).

Wire it as a curriculum knob (mirrors the existing `subMode: medicine-amboss |
medicine-uptodate` pattern), e.g. `scope` on `TriggerContext`.

---

## 2. The missing dimension — a "Foundations" block

The current AMBOSS skeleton is **clinical-reasoning-first** (recognize → reason → treat).
It omits the basic-science scaffold:

- **Anatomy** (pericardial layers, reflections, the pericardial space)
- **Pathophysiology** (inflammation cascade; effusion → tamponade mechanics)
- **Biochemistry / molecular** (inflammatory mediators; troponin leak = myopericarditis)
- **Epidemiology** (incidence, demographics, viral seasonality, recurrence rates)

These must **not dilute the active-recall flow.** They live as a dedicated
**"Foundations — Background & Deep Dive"** block: collapsible, reference-style, anchoring
the clinical chapters without breaking the vignette rhythm.

**Progressive depth — the "learn more" affordance.** Pathophysiology and biochemistry
especially are a **deep layer**, not a flat paragraph. The Foundations block presents a
*summary first*, with an explicit **"learn more"** drill-down into the deeper mechanism
(molecular cascade, pressure-volume curves, mediator pathways). The learner chooses the
depth: skim the summary for board-level recall, or expand into the full mechanism when they
want mastery. This depth itself is a reusable, class-owned unit (§3) — the deep pathophys of
the pericardium is authored once and inherited by every pericardial disease.

**Foundations are OWNED BY THE CLASS, INHERITED BY THE DISEASE.** Anatomy/path/biochem/epi
of the pericardium are shared across all pericardial diseases — author them **once** at the
class node; each disease deep-dive **pulls them in** as its Foundations section and adds only
its disease-specific specifics. No rewriting the same anatomy 5×; the class survey and the
disease deep-dive cannot drift apart.

---

## 3. Author-once / reference-everywhere — and the repeat/pull/cite policy

The core anti-repetition rule. When a disease lesson overlaps content that already exists
(in the class lesson, in a sibling disease, or in another domain), chiron makes a
**generation-time decision per content unit**:

| Decision | When | Effect |
|---|---|---|
| **REPEAT** (regenerate) | unit is small + central to *this* lesson's flow (e.g. the headline vignette) | author fresh, store as a new stable id |
| **PULL** (inherit) | unit is shared foundational content the class owns (anatomy, pathophys) | embed the class-owned block by reference; one source of truth |
| **CITE** (link) | unit is a full *other* lesson / deep tangent | link out ("see the Acute Pericarditis deep-dive"), don't inline |
| **HYDRATE** (reuse + reskin) | a verified assessment card applies here too | reuse the same `card_id`, re-skin via `hydrate.ts` so it isn't a stale dupe |

Default bias: **PULL/CITE shared content, REPEAT only what's local-and-central.** Quantify
later with an eval, but the principle is DRY-for-lessons.

### Cross-domain reuse (the Italian case)

The same medical content unit feeds **both** the pure-medicine lesson *and* the
medicine×Italian lesson (`/chiron-medical-ward`, Lucrezia persona). A clinical fact tagged
with a `concept_id` is domain-neutral; the Italian lesson PULLs it and re-presents it as a
simple, board-style MCQ that teaches the medical subject **and** Italian simultaneously.
One verified fact → two domains, no re-verification.

---

## 4. Readiness — what already exists vs the gap

**The data layer is ~80% built.** `lib/catalog/` already is the cross-lesson content DB:

| Asked-for capability | Already in `lib/catalog/` | Gap |
|---|---|---|
| Central content store, multi-lesson | `db.ts` — Drizzle SQLite, liftable to Postgres; `bundles / chapters / cards / card_tags` + FTS5 | store unit is the **card** (assessment item); needs a unit for **narrative Foundations blocks** |
| Author-once stable IDs | `cards.id` ladder (`<concept>:<ord>` etc.), `idx_cards_concept` | extend ID scheme to foundations/exposition blocks |
| Pull verified content from other lessons | `similar.ts` — `byConcept` + `byText` (FTS5), cross-bundle | exists for cards; needs the REPEAT/PULL/CITE *policy* at generation time |
| Reuse without stale repetition | `hydrate.ts` — deterministic option-shuffle reskin | ready as-is |
| Cross-domain reuse | `bundles.domain` + `cards.concept_id` (domain-neutral concept link) | needs the Italian-lesson PULL path wired |
| Scope = class vs disease | — | **not built**: no `scope` knob; the taxonomy is not yet the spine of generation |

**Verdict: well poised.** The hard part (a stable-ID cross-lesson catalog with cross-bundle
similarity + FTS + concept linkage + reskin) is done. What's missing is mostly *orchestration*,
not *substrate*:

1. Add a `scope: system | class | disease` curriculum knob.
2. Bind chiron to a **pluggable disease taxonomy** as the node spine (system→class→disease) — supplied as a generic input, never hardcoded.
3. Extend the catalog's reusable unit from card → also **Foundations/exposition blocks**.
4. Implement the **REPEAT/PULL/CITE** decision at generation time (§3 table).
5. Wire the class→disease **inheritance** (disease deep-dive pulls class Foundations).

Steps 1, 4, 5 are pipeline/prompt work; step 3 is a small schema add; step 2 is the
integration with the taxonomy DB.

---

## 5. Open questions (for the eval / next pass)

- How much overlap triggers PULL vs REPEAT — a similarity threshold, or author judgment?
- Does the disease deep-dive embed the class Foundations inline, or link + summarize?
- Should `scope: class` reuse the member diseases' *existing* deep-dive cards (compose
  upward), or author class-level cards fresh and let diseases inherit downward?
- Does chiron consume an external taxonomy as the canonical node spine, or mirror it into
  its own catalog?
