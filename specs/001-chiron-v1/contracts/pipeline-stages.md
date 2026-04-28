# Pipeline Stage Contract — 5-Stage Generation Pipeline

**Source**: FR-005, PRD §9.1, plus FR-007 (medicine verifier carve-out), FR-028 (progress reporting), FR-029 (deep-research opt-in).

This contract defines the I/O of each stage, what the stage MUST do, what it MUST NOT do, and how it reports progress.

---

## Stage 0 — INGEST

**Input**: `TriggerContext` (see [`skill-triggers.md`](./skill-triggers.md)) + raw source bytes (file, URL, repo path, folder, bundle).

**Output**: `Brief` (see [`../data-model.md`](../data-model.md) §1.1).

**MUST**:
- Dispatch to the correct per-source-type adapter from FR-032 (a-l):
  - `code-repo.ts` for git repos / local dirs / single source files
  - `pdf.ts` for text PDFs (`pdfjs-dist`) AND scanned PDFs (vision fallback per R-04 revised)
  - `image.ts` for single image files OR folders of page-image files (vision)
  - `multi-pdf.ts` for ordered lists / dirs of PDFs (delegates to `pdf.ts` per file, concatenates)
  - `url.ts` for web URLs AND standalone local `.html` files
  - `transcript.ts` for chat / meeting / lecture transcripts
  - `vocab-list.ts` for language CSVs
  - `agent-report.ts` for markdown / JSON output from another agent (marks source `secondary`)
  - `bundle.ts` for mixed-source folders — walks the folder, dispatches each file to its adapter, honors optional `chiron.manifest.json`
- For ALL local-file sources (PDF, image, image-folder, multi-PDF, transcript, vocab CSV, html-file, agent-report, bundle): copy source(s) into `<lesson-output-dir>/source/` preserving directory structure (FR-030).
- For vision-extraction paths (scanned PDFs, single images, image folders, mixed bundles with images): route through the **`mcp__gemini-mcp__interpret_image`** MCP tool — NOT Anthropic vision. Log every interpret_image call in `llm_usage` with `provider='gemini'`, the model returned by the MCP server, the image count, and the resolved cost (FR-014, FR-033).
- For multi-source ingests (`multi-pdf`, `image-folder`, `bundle`): produce ordered concatenated `extractedText` AND populate `Brief.sourceManifest[]` with one `SourceFileEntry` per file (FR-034).
- For `agent-report` ingests: set `agentSourceProvenance` and mark the entry `secondary`.
- Refuse medicine generation when **only** secondary (`agent-report`) sources are present (FR-035, SC-016).
- Refuse medicine generation with no source-grounding at all (FR-016).
- Skip unrecognized files in a bundle with a logged warning naming the file (spec edge case).
- Refuse formats Chiron cannot recognize, listing what was supplied vs what would have been recognized (FR-032).
- Emit progress: `[stage 0/5] ingest: <source-type> (<N> files, <M> images)`.

**MUST NOT**:
- Hallucinate / synthesize source text the user didn't supply.
- Call any text-LLM in this stage (vision-extraction calls are NOT text-LLM calls — they're deterministic-with-randomness extractors and are explicitly allowed and logged).
- Silently include files of unknown type in a bundle.
- Use an agent-report as the sole grounding for medicine.

---

## Stage 1 — BRIEF

**Input**: `Brief` from Stage 0 (with `extractedText` populated, syllabus + widgets fields empty).

**Output**: `Brief` enriched with domain-specific structured metadata (e.g. for medicine: identified condition / drug class / system). Also writes `brief.json` sidecar to `<lesson-output-dir>/`.

**MUST**:
- Use whatever model the parent Claude Code session is running on (R-06 revised by Q8).
- Use the per-domain Stage-1 prompt template (`prompts/01-brief.md`).
- Emit progress: `[stage 1/5] brief: …`.

**MUST NOT**:
- Make a direct Anthropic SDK call (Q8).
- Invoke `mcp__gemini-mcp__start_deep_research` silently — that path is gated to user opt-in (FR-029).

---

## Stage 2 — SYLLABUS

**Input**: enriched `Brief` + the domain's concept DAG + curriculum template.

**Output**: `ChapterSyllabus[]` (one entry per chapter, validated by Zod).

**MUST**:
- Be executed by the parent Claude Code session (Q8) — Opus model preferred for structural planning if the user has chosen Opus, but Chiron does not enforce this.
- Inject the chosen theme tokens into the system prompt (FR-024 — `buildThemePromptBlock()`).
- Enforce minimum 3 `scienceAnnotations` per chapter (FR-022).
- Enforce 2-4 `spacingConnections` for chapter 8+ (FR-022).
- Emit progress: `[stage 2/5] syllabus: <N> chapters planned`.

**MUST NOT**:
- Fill in chapter narrative or quiz items — that's Stage 4. This stage produces the *plan*, not the content.

---

## Stage 3 — VALIDATE

**Input**: `ChapterSyllabus[]` from Stage 2.

**Output**: validated `ChapterSyllabus[]` (or abort with structured error).

**MUST**:
- Run Zod schema validation on every chapter (FR-006).
- Run concept-DAG validator: every `keyConcepts` entry exists in the domain's DAG; no concepts referenced before their prereqs were introduced.
- Run rubric check: scienceAnnotations and spacingConnections invariants from FR-022.
- For **medicine domain only**: run the QUEST-AI 3-stage verifier loop (Generate → Verify → Refine). See [`prompts/medicine-only/`](../../skill/prompts/medicine-only/) once authored. Up to 3 attempts; if all fail, abort the chapter (SC-011).
- Retry the LLM up to 3 attempts with structured issue feedback when validation fails.
- Emit progress: `[stage 3/5] validate: chapter <N> ok`.

**MUST NOT**:
- Silently ship invalid syllabuses.
- Run the verifier loop on non-medicine domains (it's opt-in elsewhere per FR-007 — not exercised in v1 outside medicine).

---

## Stage 4 — BUILD

**Input**: validated `ChapterSyllabus[]`.

**Output**: per-chapter HTML fragment + populated `WidgetSpec[]` + `sr_cards` rows + (language only) TTS audio files in `<lesson-output-dir>/audio/`.

**MUST**:
- Fan out per-chapter, parallelizable across chapters (rate-limit-respecting).
- For each chapter, generate:
  - Chapter narrative HTML (Opus 4.6 prose).
  - Quiz items for every `WidgetSpec` slot.
  - Peer-learner dialogue (`prompts/04l-peer-dialogue.md`) — Alice/Bob/Mike/Priya/Luca/Sofia per persona file.
  - Domain-expert dialogue (`prompts/04m-domain-expert.md`).
  - SR cards (`prompts/04n-sr-card-gen.md`).
  - For language: TTS for native-speaker dialogue lines (Gemini default per R-01).
- Run the answer-balancer post-pass per chapter via a dedicated prompt template (FR-006 utility — defeat longest-correct-answer artifact). Q8: the parent agent runs this prompt; no Haiku-specific routing.
- At end of each chapter, summarize "what user struggled with" into 3 bullets and pass to next chapter's persona prompt (FR-023).
- Emit progress per chapter: `[stage 4/5 chapter <N>/<M>] writing chapter…`, `[stage 4/5 chapter <N>/<M>] quizzes`, etc.

**MUST NOT**:
- Bundle Pyodide eagerly into HTML — load lazily from CDN if `code-runner` widget present (R-03).
- Silently call `start_deep_research` — FR-029 gates it to user opt-in, ≤1/lesson.

---

## Stage 5 — ASSEMBLE

**Input**: per-chapter HTML fragments + widget instances + SR cards + audio.

**Output**: single self-contained `lesson.html` + initialized `.chiron-state.db` + `source/` (if PDF source).

**MUST**:
- Run `shell/build.sh` to convert multi-file authoring into single-file delivery, **inlining all `shell/vendor/*` libraries** per FR-037 (Q9) so the lesson opens with zero CDN calls (except optional Pyodide per R-03).
- Initialize SQLite at `<lesson-output-dir>/.chiron-state.db`:
  - Apply schema from [`sqlite-schema.sql`](./sqlite-schema.sql) (no `llm_usage` / `llm_cache` tables — Q8).
  - Insert `_chiron_meta.schema_version = '1'`.
  - Seed `sr_cards` with chapter 1 cards due now; later chapters' cards due-after their chapter is completed.
  - Seed `bookmarks` with chapter 1 entry.
- Open `lesson.html` in the user's default browser.
- Emit progress: `[stage 5/5] assemble: lesson.html written, opening in browser`.

**MUST NOT**:
- Require a build step from the user (no npm install / no webpack) — `build.sh` runs at generation, not at view (FR-009).
- Phone home (FR-017 — no telemetry, no analytics).

---

## Cross-cutting requirements

### ~~Cost guard~~ (REMOVED by Q8)

There is no in-tree cost guard. Cost visibility is whatever Claude Code surfaces for the parent session and whatever Gemini MCP prints inline. The user controls the parent session and can interrupt at any time.

### Progress reporting (FR-028, SC-012)

Every stage emits at least one progress line on stderr with prefix `[stage N/5]`. Stage 4 emits per-chapter lines with prefix `[stage 4/5 chapter <N>/<M>]`. Stage 0 announces image-extraction count up front when applicable: `[stage 0/5] ingest: scanned-PDF (32 pages — 32 interpret_image calls follow)`. No period of >30s passes silently.

### Deep-research opt-in (FR-029, SC-013)

`mcp__gemini-mcp__start_deep_research` is **never** invoked by default. It is callable only when the user explicitly says "expand on X" / "go deeper on Y" mid-conversation, AND only once per lesson. The agent uses `start_deep_research` → `check_research_status` → `get_research_results` → `save_research_to_markdown` (saved into `<lesson-output-dir>/research/`). Across the 4 golden inputs, aggregate count is exactly zero.

### LLM-call architecture (Q8 — replaces FR-014 LLM gateway)

There is no in-tree LLM gateway. Every text-LLM operation in the pipeline (Stages 1, 2, 3, 4) is performed by the **parent Claude Code agent** in its own context as it executes the skill's prompts. Every vision operation is performed by the **`mcp__gemini-mcp__interpret_image`** MCP tool. Cost / token / cache management is whatever Claude Code and the MCP server provide natively; Chiron does not duplicate it.

### MCP toolset (FR-036)

SKILL.md MUST list the Gemini MCP tools the buildout/runtime agent has at its disposal (see FR-036 / R-11 for the canonical table). Other MCP servers (e.g. `mcp__context7-mcp__query-docs`) are also fair game when a lesson needs them.

### Runtime library vendoring (FR-037 / Q9)

Stage 5 Assemble inlines all small vendored libraries from `shell/vendor/` into `lesson.html` so the lesson opens with no CDN calls. Pyodide is the sole exception (lazy CDN per R-03); when offline the `code-runner` widget falls back gracefully and the rest of the lesson renders fully.
