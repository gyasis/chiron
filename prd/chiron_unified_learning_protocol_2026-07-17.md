# Chiron Unified Learning Protocol — Capture → Decompose → Train PRD

**Date:** 2026-07-17
**Status:** DRAFT — design converged in-session (2026-07-17). Build order locked: 1 → 2 first.
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_storage_consolidation_2026-06-19.md`](./chiron_storage_consolidation_2026-06-19.md) (the catalog + cross-lesson SR this rides on), [`chiron_assessment_engine_2026-06-19.md`](./chiron_assessment_engine_2026-06-19.md) (the question/dynamicity engine the MCQ generator should feed), project memory `project-chiron-lesson-tutor` (the :8912 tutor this hangs off), `project-chiron-corpus-postgres` (the :5442 store everything lands in).

**Delete when:** steps 1–6 ship and a captured item can round-trip: highlight/star → browser → dispatch → sr_cards due in the SR rotation.

---

## 1. Problem

The in-lesson tutor (`:8912`) now produces genuinely good, dense output (e.g. a full pathophysiology of bilious vomiting). **All of it evaporates.** Specifically:

- **The tutor chat is in-memory only.** Close the drawer or reload → the session is gone. (Observed 2026-07-17: the first entry vanished from a live session.) Nothing else in this PRD is possible until this is fixed.
- **There is no way to keep an insight.** To remember it you must re-run the same tutorial session — the exact thing the learner said he refuses to do.
- **The highlighter already captures terms** (numbered pills in the tutor) but they are decorative — they go nowhere.
- **Three capture surfaces already exist and are unrelated:** the tutor's ⭐ (absent), the tutor's 🖉 highlight pills, and the SSM exam app's 📌 collect bar → notes browser → Chiron/AMBOSS/Discuss actions. The SSM one is the *proven* pattern; the tutor has nothing.

## 2. The insight (the user's framing — do not violate)

**One primitive, one dispatcher.** A highlighted term, a starred answer, and an SSM collected item are *the same thing at different granularity* — a **captured item**. They differ only in size:

- a **pill** = an *atom* (`aromatase`, `CHA₂DS₂-VASc`) → cards, MCQs
- a **star** = an *explanation* (the reasoning that made the atom land) → the lesson seed
- together = *"build me a lesson on these 5 terms, grounded in the explanation that taught me them"* — which neither gives alone

**Star is an INBOX, not a destination.** Capture must be one click at the moment of insight; the *decision* (card? MCQ? lesson?) is deferred to a processing mindset. This is the GTD/collect-bar pattern the SSM app already validates. The failure mode to design against is inbox-rot, not capture friction.

## 3. Decision

**Decompose is the SPINE, not a sibling generator.** Once a note is broken at its real teaching seams, every downstream generator improves: cards per-topic beat cards from a blob; MCQs can target one discriminator each; a lesson gets a real syllabus instead of an LLM guessing structure.

```
CAPTURE  🖉 pill · ⭐ star · 📌 SSM collect   → ONE store (corpus :5442) WITH PROVENANCE
   ↓
SELECT   pills are already a multi-select surface; pick 1..n
   ↓
🧬 DECOMPOSE  (the spine)  → teaching seams + discriminating rules
   ↓
DISPATCH  🎴 Cards → sr_cards   ❓ MCQs   🎓 Train me   📚 Lesson → Chiron
   ↓
BROWSER  FTS/RAG over "everything I ever flagged" (exam + tutor together) · unprocessed count
```

### 3.1 Provenance is the value (the decision that makes or breaks it)

A bare term makes garbage cards — `aromatase` → *"What is aromatase?"* is useless. The same term **+ the section it was highlighted in + the tutor answer that explained it** yields *"Blocking 5α-reductase shunts testosterone → which enzyme, and what's the clinical consequence?"* — the card actually needed.

**Every captured item therefore stores its context, not just the string:**
`{id, kind: term|answer|note, text, lesson_slug, section_id, surrounding_text, source_answer, source_question, concept, model, created_at, processed_at}`

### 3.2 Batch-in → batch-out

Dispatching 5 pills must yield **one coherent artifact** (a lesson covering all five, a card *set*), never five disconnected ones. The relationships between the terms are half the learning.

### 3.3 Inbox must drain

Capture is frictionless, so the queue will fill. Two non-negotiables or it becomes a landfill:
1. **Bulk process** — "turn these 5 into cards" in one action.
2. **A visible unprocessed count** — the queue is a live thing, not a graveyard.

## 4. The decompose chain (PromptChain shape)

Static + sequential — no agentic control flow (house rule R-PC2). `ExternalLoop` over the topic worklist is the exact primitive for "N topics, same treatment each": bounded, deterministic.

```
[Callable: note + provenance]
  → [LLM: decompose → N teachable topics + the DISCRIMINATING rules]     # one call
  → ExternalLoop(over topics):
        [LLM: micro-teach topic] → [LLM: one drill question + why-wrong]
  → [Callable: assemble the training path]
```

**The seams must be real.** Worked example (the bilious-vomiting answer decomposes to):
① the checkpoint (pylorus — why bile only appears if the block is BELOW it) · ② mechanical (malrotation/volvulus, intussusception, adhesions, hernia, gallstone ileus) · ③ functional (paralytic ileus, pseudo-obstruction) · ④ chemical/inflammatory (gastroenteritis, pancreatitis) · ⑤ **the discriminator** (bilious *excludes* gastric outlet obstruction).

Cards must encode ⑤-type **rules and "definitely-not-it" boundaries**, not the essay. That is what makes recognition happen under exam pressure.

**Sizing:** 🎓 Train me sits between a card (atom) and a full Chiron lesson (heavy, with audio). Expected to be the most-used destination — it matches a real study moment: *"I just learned something dense; drill me on it now."*

## 5. Build order (locked)

| # | Step | Why this order |
|---|---|---|
| 1 | **Persist the tutor chat** | The bug. Everything depends on it — "star it later" is impossible if the session evaporates. |
| 2 | **`captured_items` + ⭐/pill capture WITH provenance** → corpus :5442 | Makes it *safe to capture today*; nothing is lost while the rest is built. |
| 3 | Selectable pills + dispatch bar | One component, reused in the tutor AND the browser. |
| 4 | 🧬 decompose chain (the spine) | Improves every generator below it. |
| 5 | Generators off the spine: 🎴 Cards → `sr_cards` · ❓ MCQs · 🎓 Train me · 📚 Lesson | Cards first — SR is what removes the need to redo the session. |
| 6 | Browser + FTS/RAG + unprocessed count | The drain ritual. |

## 6. Where it lives

- **Store:** corpus Postgres `:5442` — `captured_items` sits alongside `quiz_attempts` / `mastery` / `weakness_log`, so *"what I struggle with"* can eventually include what the tutor was asked about.
- **Search:** Postgres FTS covers "search my past tutor sessions" on day one. Embeddings/semantic RAG only if FTS proves thin (economy-first — do not add an indexer that earns nothing).
- **Cards land in** the per-lesson `.chiron-state.db` `sr_cards` (ease_factor / interval_days / next_due_at) → they enter the existing SR rotation and are ETL'd to the corpus on accept.
- **Reuse, don't rebuild:** the SSM app's `CollectBar` / `NotesBrowser` / `NoteDetail`+`fireChiron` are the proven implementation of this workflow. Port the pattern; do not reinvent it.

## 7. Non-goals

- No new indexer/vector store unless FTS demonstrably fails (economy-first).
- Cards are **not** stripped into a central-only bank — lesson-bound questions stay with the lesson (assessment-engine PRD, concern #2).
- Chiron stays **domain-general**: SSM is a dogfood consumer, never baked in (R-CH5).

## 8. Open questions

- Do SSM-collected items and tutor captures share one `captured_items` table (one browser across both apps) or stay per-app with a federated view? *Leaning: one table — that is what makes it a unified protocol.*
- Auto-decompose on ⭐, or only on dispatch? *Leaning: on dispatch — decomposition costs a model call; don't spend it on items that never get processed.*
