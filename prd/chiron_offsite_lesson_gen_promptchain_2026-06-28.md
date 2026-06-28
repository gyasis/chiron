# Chiron — Off-site lesson generation: agent-flow → PromptChain INVESTIGATION PRD

**Date:** 2026-06-28
**Status:** DRAFT — investigation scoped. To be **executed in a fresh session** driven by this PRD. No build/hookup until the verdict lands.
**Owner:** Gyasi Sutton (solo)
**Type:** Investigation / feasibility (not a build PRD)
**Related:**
- [`chiron_hub_phone_sync_generate_2026-06-24.md`](./chiron_hub_phone_sync_generate_2026-06-24.md) — **this unblocks its Phase 2** (the `/generate` + `/jobs` job runner; what "Generate" on the phone actually invokes).
- [`chiron_lesson_scope_and_reuse_2026-06-24.md`](./chiron_lesson_scope_and_reuse_2026-06-24.md) — scope-dial (a job-payload field).
- `/promptchain` skill + PromptChain library (project memory `reference-promptchain-skill.md`).

**Delete when:** the investigation produces (a) the per-domain generation step-map, (b) the job-payload schema, and (c) a PromptChain go/no-go verdict, AND that decision is folded back into the hub Phase-2 PRD.

---

## 1. Why this exists (the problem)
Chiron's lesson generation today is **agent-in-the-loop by design** — `lib/pipeline.ts` hands text-LLM stages 1–4 to "the parent Claude Code agent" and **makes no SDK call** (PRD Q8; consistent with CLAUDE.md "LLM is advisor, agent in loop"). That is *perfect* for a **human driving a Claude Code session**, but it does not give us **off-site / unattended generation** — which is exactly what the Chiron Hub's phone "Generate" button needs (nobody is at a terminal).

The two things we don't yet have a definition for:
1. **The job payload** — what must be fully pre-specified so a lesson can be generated with *no human to ask*.
2. **"The skill we would normally ask"** — the interactive decision points the agent currently makes (scope, grounding source, mode, clarifications) that an unattended process must pre-answer or auto-resolve.

**Hypothesis to test:** the agented, multi-step generation (especially **medicine**, which does a lot of research + grounding pulls) can be **recreated deterministically as a PromptChain**, so it runs headless and reproducibly — instead of (or alongside) a free-form agent. If a PromptChain can rebuild the *same* lesson, that chain becomes the hub's job runner.

## 2. Goal of the investigation
Produce enough evidence to decide the **off-site generation engine**:
- **(A) PromptChain** — explicit, deterministic step-chain (preferred if feasible).
- **(B) Headless Claude Code "YOLO"** — `claude -p … --dangerously-skip-permissions` as the autonomous parent agent (reuses the existing pipeline; can't take human input mid-run).
- **(C) Hybrid** — PromptChain for the deterministic spine, with a few bounded agent/tool steps where judgment is genuinely required.

## 3. What we already know (don't re-derive)
- **5-stage pipeline** (`SKILL.md` §"5-stage pipeline" ~L185; `lib/pipeline.ts`): Stage 0 preflight/refusal (grounding check) → 1 Brief → 2 Syllabus → 3 Validate (retry ≤3, FR-006) → 4 Build widgets → 5 Assemble (+ Atelier bake). Stages 1–4 emit a **prompt template** for the parent agent; the deterministic tail (5 assemble, bake, bundle, catalog) is already scriptable (`lib/assemble.ts`, `bake-lesson-audio.mjs`, `scripts/bundle-lesson.sh`, `scripts/build-library-index.mjs`).
- **Domains:** `code · medicine · medical-italian/language-it · research-paper · concepts` (+ `music-theory`). See `concepts/*.json` (concept DAGs) and `curricula/*.json` (incl. `medicine-amboss`, `medicine-uptodate`, `language-it-*`).
- **Stage prompt templates** live in `skill/prompts/`: `01-brief.md`, `02-syllabus.md`, `03-validate-rubric.md`, `04a-chapter-write.md`, the `04b…04t` widget/quiz/peer/lecture/passage prompts, `05-answer-balancer.md`, plus `00-ingest/` and `medicine-only/`. These ARE the chain steps if (A) is feasible.
- **Per-domain grounding (R-CH3, BLOCKING):** pure-medicine → Harrison's 22e RAG (`harrison-search`) + `gemini_research`; medical-language → SSM MCQ DeepLake + MRCP PACES. **Never deep-research for lessons.** This is where medicine "does a lot of steps."
- **Keep chiron domain-general (R-CH5):** the SSM taxonomy is a *pluggable input*, never baked into the chain.

## 4. Investigation tasks (the actual work for the fresh session)
1. **Map the generation flow per domain.** Read `SKILL.md`, `lib/pipeline.ts`, every `prompts/*` template, `concepts/*`, `curricula/*`. Emit a table: **stage → prompt template → tools/MCP called → input slots → output artifact**, one row per step, per domain. Mark which steps are pure-prompt vs tool-bearing vs judgment.
2. **Session-search ALL prior lesson generations.** Use `~/.local/bin/session-search` (widen `--recent` as needed; also try `sio search`). For every lesson ever built: record **domain, sub-mode/curriculum, and the actual agent step-sequence + tool calls** (esp. medicine: `harrison-search`, `gemini_research`, grounding pulls, the widget/quiz prompt fan-out). **Count the steps** and note time/cost hotspots. Goal: empirical evidence of "how many steps an agent really takes," medicine highlighted.
3. **Characterize decision points / interactivity.** From the traces, list every place the agent (a) asked the human, or (b) made a free-form judgment (scope-dial, grounding-source pick, mode detection, clarifications, retry decisions). Each becomes a **job-payload field** or an **auto-default rule**.
4. **Define the job-payload schema.** The minimal fully-specified input for unattended generation — at least: `subject, scope, domain, sub-mode/curriculum, persona/voice, grounding source(s)`. Map each field back to the decision point it removes (task 3).
5. **PromptChain feasibility spike.** Pick ONE recently-generated **medical** exemplar (e.g. an AMBOSS lesson — `chiron-klinefelter-amboss` or `chiron-acute-pericarditis-amboss`). Map each agent step → a PromptChain step / `AgenticStepProcessor` (which are pure-prompt, which need tools/MCP, which need the Stage-3 validator retry loop). **Invoke `/promptchain` before writing any PromptChain code** (the API is not in training data). Produce a **draft chain skeleton** + a **go/no-go**.

## 5. Deliverables
- **D1** — per-domain generation **step-map** (the "recipe"), with step counts.
- **D2** — empirical **agent step-count + tool-sequence** per domain from session traces (medicine highlighted).
- **D3** — the **job-payload schema** (+ which decision point each field retires).
- **D4** — **PromptChain feasibility verdict** + a draft chain for one medical lesson.
- **D5** — **engine recommendation**: A (PromptChain) / B (headless Claude Code YOLO) / C (hybrid), with rationale.

## 6. Key questions to answer
1. How many discrete steps does a **medical** lesson actually take end-to-end, and where is the time/cost?
2. Which steps are **deterministic** (chainable) vs need genuine **agent judgment**?
3. Can grounding (`harrison-search`, the MCQ/PACES corpora) be called as plain **tool steps inside a chain**, or does picking/synthesizing grounding need an agent?
4. What's the right **engine** (A/B/C) — and if hybrid, where's the seam?
5. What does "**failed**" do with no human reviewer (validator retry + QUEST-AI verifier + Gemini audio-QC → review queue vs silent retry)?

## 7. Reuse / tools / pointers
- `~/.local/bin/session-search` (cross-session lesson-gen traces) · `sio search`.
- `skill/SKILL.md`, `skill/lib/pipeline.ts`, `skill/prompts/`, `skill/concepts/`, `skill/curricula/`.
- `/promptchain` skill + PromptChain library (memory: `reference-promptchain-skill.md`).
- Grounding rules: `~/.claude/rules/domains/chiron.md` (R-CH1 bake, R-CH3 grounding, R-CH5 domain-general).
- Deterministic tail already built: `lib/assemble.ts`, `bake-lesson-audio.mjs`, `bundle-lesson.sh`, `build-library-index.mjs`.

## 8. Scope guardrails
- **Investigation only** — no `/generate`/`/jobs` build, no hookup, no testing until the D5 verdict.
- Keep chiron **domain-general** (R-CH5) — the chain takes a taxonomy/subject as input; no exam specifics baked in.
- Bake still routes to **Atelier on the Mac** (R-CH1); one omnivoice ⇒ bakes serialize regardless of engine.

---

*Captured 2026-06-28. This is the secondary branch from the Hub Phase-2 discussion: define the job payload + the deterministic generation process (PromptChain vs headless agent) BEFORE wiring the Generate button. Big side project — run it in its own session.*
