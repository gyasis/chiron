# Feature Specification: Chiron v1 — Universal Lesson Generator

**Feature Branch**: `001-chiron-v1`
**Created**: 2026-04-28
**Status**: Draft
**Input**: User direction: "the prd is the spec, memory-bank helps with research and plan"

## Clarifications

### Session 2026-04-28

- Q: Italian language (`language-it`) scope for v1 ship — keep German, swap to Italian, ship both, or stub? → A: Swap — v1 ships Italian only; German moves to post-v1.
- Q: Skill trigger phrases — natural-language only, single keyword, slash-commands, or combo? → A: Both natural-language phrases AND slash-commands as parallel entry points.
- Q: Performance bound for full course generation — hard cap, soft cap with progress, per-domain budgets, or none? → A: Soft cap with per-stage progress reporting; $25 cost guard is the backstop. Plus: Gemini `start_deep_research` is called at most once per lesson, only if the user explicitly asks for it; default is never invoked.
- Q: Source-PDF storage relative to lesson output dir — copy in, reference by path, discard, or prompt? → A: Copy source into `<lesson-output-dir>/source/` for reproducibility. No PHI concerns (solo personal use).
- Q: Default chemistry-rendering library (Kekule.js vs RDKit-JS) — pick now or defer? → A: Defer (per PRD §14 Q1). Plan against an abstract `MoleculeRenderer` interface; Phase 4 prototype picks the concrete library.
- Q: Lesson input source types — current PRD covers code-repo, text-PDF, vocab CSV, transcript, URL only. Should v1 also handle scanned PDFs, image-folder bundles, multi-PDF-as-one-chapter, agent-generated reports, standalone HTML files, and mixed-source folders? → A: **Full scope** — v1 supports all of these. Reverses PRD R-04's "no OCR" deferral and PRD §13's "image input deferred" entry.
- Q: Vision provider for image extraction (scanned PDFs, image folders, single images, figure interpretation in bundles) — Anthropic vision in-SDK or Gemini `interpret_image` MCP? → A: **Gemini `mcp__gemini-mcp__interpret_image`** for all image-content reading. Aligns with the user's existing Gemini-as-paired-partner toolchain (`~/.claude/rules/tools/gemini.md`).
- Q: LLM-call architecture — direct SDK with own API keys, hybrid, or pure skill-driven? → A: **Pure skill-driven, no direct SDK calls.** Chiron is a Claude Code skill: the parent Claude Code agent does all text-LLM work natively (chapter writing, syllabus, peer dialogue, validation). Gemini access is via MCP (`mcp__gemini-mcp__*` family). Other MCP servers (context7-mcp for library docs, etc.) are fair game when a lesson needs them. **Reverses PRD §3 #8 and §11** (50-line `llm.ts` gateway with sha256 cache + cost log) and PRD §3 #12 (cost guard). Drops `@anthropic-ai/sdk` dependency, drops `llm_usage` / `llm_cache` SQLite tables, drops the $25/course cost guard. Cost tracking is whatever Claude Code natively shows + whatever Gemini MCP reports inline. The `start_deep_research` cap (FR-029) still applies — gating is at the agent level, not at an SDK level.
- Q: Runtime libraries (MathJax, mhchem, Mermaid, Pyodide, ChalkAI, MoleculeRenderer) — vendor into skill, all CDN, or hybrid? → A: **Vendor small libs into `chiron/skill/shell/vendor/`** (baked into the single `lesson.html` at generation time); Pyodide stays lazy-CDN-only because 8MB is too large to inline (R-03 unchanged). Delivers Constitution V "self-contained local output, zero telemetry" — the lesson opens with no network on first view for everything except the optional `code-runner` Python widget.

> **Source of truth:** [`prd/chiron_design_v1_2026-04-28.md`](../../prd/chiron_design_v1_2026-04-28.md). This spec is its companion in speckit-template form. When the PRD and this spec disagree, the **PRD wins** and this spec is updated to match. Memory-bank files (`memory-bank/projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`, `follow_ups.md`) are research/planning context, not normative.

## User Scenarios & Testing *(mandatory)*

The audience is a single solo learner (Gyasi). User stories below are the four co-equal v1 domains, prioritized by buildout order in the PRD (§13). Each is independently testable: the lesson it produces opens in a browser, runs without a server, and persists state in SQLite alongside the HTML output.

### User Story 1 — Code-domain lesson from a small repo (Priority: P1)

The learner points Chiron at a small TypeScript repository and asks for a course. Chiron ingests the repo, generates a multi-chapter scroll-snap HTML lesson with side-by-side code+English, MCQ + true/false + spot-the-bug quizzes, AI peer-learner dialogue (Alice, Bob) discussing architectural choices, and SR cards for the key concepts. The lesson opens with `index.html` and works offline. Re-opening it shows due cards at the top and restores scroll position.

**Why this priority**: Code is the simplest domain (no fuzzy grading, no PDF ingestion, no chemistry rendering, no high-volume vignette generation). It exercises the full pipeline end-to-end and validates the heritage shell + LLM gateway + SQLite + SR scheduler with the smallest surface area. PRD Phase 2.

**Independent Test**: Run Chiron against `tests/golden-inputs/code-small-repo/` → expect a generated `lesson.html` with ≥3 chapters, ≥8 quiz items per chapter, AI peer dialogue present, and `.chiron-state.db` initialized. Re-open the HTML and confirm resume + due-card surfacing.

**Acceptance Scenarios**:

1. **Given** a small TypeScript repo and an `ANTHROPIC_API_KEY`, **When** the learner invokes the Chiron skill with the repo path, **Then** a single-file `lesson.html` is produced with chapters, quizzes, peer dialogue, and an initialized `.chiron-state.db` next to it.
2. **Given** a previously-generated code lesson, **When** the learner re-opens `lesson.html` after answering some quizzes, **Then** their scroll position is restored, completed chapters are marked, and any due SR cards surface inline at the top of the page.
3. **Given** a generated code lesson, **When** the learner opens it on a machine with no network and no build tools, **Then** the lesson renders fully (no CDN-only assets blocking core content).

---

### User Story 2 — Language (Italian) vocab + grammar lesson (Priority: P2)

The learner provides an Italian vocab list (CSV) or a grammar concept (e.g. "passato prossimo"). Chiron generates a scroll-modules lesson with chapter-by-chapter vocab/grammar arc, fill-blank exercises with fuzzy accent grading (e.g. `e`/`è`, `caffe`/`caffè`), matching-pair (N↔N) drag-drop, Anki-compatible cloze cards, and a Maria native-speaker persona producing TTS-voiced dialogue (via Gemini TTS). Re-opening surfaces due cards.

**Why this priority**: Language is the second-simplest domain. It exercises new widget primitives (`fill-blank`, `matching-pair`, `cloze`, `audio-tts`) and the TTS integration without the verifier-loop or chemistry rendering complexity. PRD Phase 3.

**Independent Test**: Run Chiron against `tests/golden-inputs/language-it-passato-prossimo/` → expect `lesson.html` with fill-blank widgets that accept "caffe"/"caffè" as equivalent, ≥30 cloze cards, and at least one Maria TTS dialogue clip. Re-open and confirm SR review surfaces vocabulary cards.

**Acceptance Scenarios**:

1. **Given** a vocab list of 50 Italian nouns, **When** the learner runs Chiron in language-it mode, **Then** a lesson is produced with ≥30 fill-blank/cloze items where "caffe" matches "caffè" without penalty.
2. **Given** a grammar concept input ("passato prossimo"), **When** the lesson generates, **Then** Maria dialogue clips are TTS-voiced and playable inline.
3. **Given** any language lesson, **When** completed, **Then** SR cards are stored in `sr_cards` and resurface on re-open per SM-2 schedule.

---

### User Story 3 — Medicine (AMBOSS-style) lesson from a textbook PDF (Priority: P3)

The learner provides a clinical textbook PDF chapter (e.g. community-acquired pneumonia). Chiron produces an AMBOSS-style lesson: 1500-2000 words, bulleted/nested format, **15-20+ clinical-vignette MCQs** with vignette stems + lab values + leading question + 5 options + per-distractor explanations + Hammer 1-5 difficulty + Attending Tip + `<keyinfo>` tags. Vignettes span the taxonomy (classic / atypical / pediatric / elderly / immunocompromised / pregnancy / comorbidity / mimicker). The lesson includes chemistry rendering (drug structures, enzymatic reactions) via MathJax+mhchem and Kekule.js or RDKit-JS, plus pathway diagrams via Mermaid or D3. The medicine-only **QUEST-AI verifier loop** runs Generate → Verify → Refine for content accuracy. Dr. Reyes (attending) + Mike (med student) + Priya (resident) personas drive Socratic dialogue.

**Why this priority**: Medicine is the highest-stakes and most complex domain — hallucinated drug doses are a safety hazard. It introduces three new widget primitives (`mcq-clinical-vignette`, `agreement-matrix`, `assertion-reason`), the verifier loop, chemistry rendering, and high-volume vignette generation. PRD Phase 4 (longest phase, ~4 days).

**Independent Test**: Run Chiron against `tests/golden-inputs/medicine-pneumonia/` → expect `lesson.html` with 15+ vignette MCQs, every vignette having keyInfo tags + per-distractor explanations + Hammer rating + Attending Tip; chemistry equations and pathway diagrams render; verifier-loop log shows ≥1 Generate-Verify-Refine cycle.

**Acceptance Scenarios**:

1. **Given** a community-acquired pneumonia PDF, **When** Chiron runs in medicine-AMBOSS mode, **Then** the output includes ≥15 vignette MCQs with the full structure (vignette / labs / Q / 5 options / per-distractor / Hammer / Attending Tip / keyInfo).
2. **Given** any medicine lesson generation, **When** content is generated, **Then** every chapter is run through the QUEST-AI verifier (Stage 2 verify) and the verifier's findings are reflected in Stage 3 refine output before HTML assembly.
3. **Given** a chapter with drug content, **When** rendered, **Then** chemical reactions render via MathJax+mhchem and at least one molecule renders through the `MoleculeRenderer` interface (concrete library selected in Phase 4).

---

### User Story 4 — Research-paper lesson from an arbitrary PDF (Priority: P3)

The learner provides a research-paper PDF. Chiron generates a scroll-modules lesson covering: Why this matters → Methods → Results → Discussion → Critical appraisal → Connections. Quizzes include MCQs on study design and primary outcome, true/false on common misinterpretations, and slider-estimation for effect-size confidence. Forest-plot widgets render the paper's primary effect size with confidence intervals. Dr. Hofmann (senior PI) and Bob (skeptical peer) personas drive the critical appraisal dialogue.

**Why this priority**: Research-paper reuses the PDF adapter built for medicine and most code-domain primitives, with one new widget (forest-plot). Lower stakes than medicine and lower volume than language, but completes the v1 four-domain commitment. PRD Phase 5.

**Independent Test**: Run Chiron against `tests/golden-inputs/research-paper-jones2025/` → expect a 6-section lesson, ≥5 comprehension MCQs, at least one forest-plot widget rendering, and Dr. Hofmann + Bob dialogue covering the methods and limitations.

**Acceptance Scenarios**:

1. **Given** an arbitrary research-paper PDF, **When** Chiron runs in research-paper mode, **Then** the output has the 6 canonical sections (motivation / methods / results / discussion / appraisal / connections).
2. **Given** a paper with quantitative results, **When** the lesson renders, **Then** at least one forest-plot widget displays the effect size and confidence interval correctly.

---

### User Story 5 — Mode B case-study from a short incident text (Priority: P3)

The learner provides a short incident write-up (<2000 words). Chiron auto-detects Mode B (case-study) and delegates to `~/.claude/skills/case-study.md` to produce a 3-act lecture (Evidence → Two Lectures → Synthesis) rather than a multi-chapter scroll-modules course. The user can override with `mode a` / `mode b`.

**Why this priority**: Mode B reuses an existing system-wide skill — the integration is small (~0.5 day per PRD §13 Phase 6). It validates the mode-selection heuristic without requiring new templates.

**Independent Test**: Pass a 1500-word incident write-up to Chiron → expect Mode B to be inferred (heuristic: <2000 words) and the case-study skill to be invoked. Pass the same input with `mode a` → expect Mode A scroll-modules output.

**Acceptance Scenarios**:

1. **Given** an input under 2000 words, **When** Chiron runs without a mode flag, **Then** Mode B is inferred and the case-study skill produces a 3-act lecture, with the inferred mode and 1-line reason shown to the user.
2. **Given** an input under 2000 words, **When** the user passes `mode a`, **Then** Mode A scroll-modules output is produced instead.

---

### User Story 6 — Adding a new domain by dropping 3 JSON files (Priority: P3)

After v1 ships, the learner wants to add a new domain (e.g. music-theory). They drop `concepts/music-theory.json`, `curricula/music-theory.json`, and `personas/music-theory.json` into the skill's directories — and optionally one prompt-template variant if the domain has unusual content shape. No skill rewrite is required; Chiron generates a music-theory lesson on the next invocation.

**Why this priority**: This is the v1 extensibility test (PRD §12 Success Criterion 7). It is the architectural validation that Chiron's per-domain adapters + JSON catalogs work. Cannot be tested until P1–P4 are built, so it lands at the end.

**Independent Test**: Author the 3 JSON files for a trivial new domain, invoke Chiron, and confirm a working lesson is produced without modifying any TS source under `lib/`, `ingest-adapters/`, or `shell/`.

**Acceptance Scenarios**:

1. **Given** the 3 JSON files for music-theory and no other code changes, **When** the learner invokes Chiron, **Then** a music-theory lesson is generated and the persona names + concept DAG + curriculum template come from the JSON files.

---

### Edge Cases

- **Cost overrun:** *(removed per Clarification Q8)* — no in-tree cost guard. The user controls the parent Claude Code session and can interrupt; per-stage progress reporting (FR-028) makes long runs visible.
- **Source too short for Mode A but flagged `mode a`:** generate Mode A anyway; surface a warning that the source may be too thin to fill scroll-modules.
- **Source too long for Mode B but flagged `mode b`:** delegate to case-study skill anyway; case-study skill itself may push back.
- **Anthropic API key missing:** fail fast with a clear error before pipeline starts.
- **Validator failure after 3 retry attempts:** abort the chapter with a structured issue report; do not silently produce broken content.
- **Medicine verifier flags content but cannot refine within 3 attempts:** abort the chapter and surface the verifier's findings to the user.
- **SQLite schema mismatch on lesson re-open:** apply migrations idempotently; if migration fails, surface error and refuse to corrupt state.
- **LLM cache hit:** *(removed per Clarification Q8)* — no in-tree LLM cache. Caching is whatever Claude Code does natively for the parent session.
- **Re-open lesson when no cards are due:** surface "no cards due — last reviewed N days ago" and allow user to pull cards forward manually.
- **PDF ingest of scanned/image-only PDFs:** **NOW SUPPORTED** in v1 via Anthropic vision (FR-032 b). Cost is higher than text PDFs; cost-estimate prompt accounts for it.
- **Mixed-source bundle with both image and text files in one folder:** ingest both, ordered alphabetically unless `chiron.manifest.json` overrides; per-file provenance preserved in `Brief.metadata.sourceManifest[]` (FR-034).
- **Agent-report supplied as the ONLY source for a medicine lesson:** refuse with a clear error — agent reports are `secondary` only; medicine domain requires at least one `primary` source (FR-035).
- **Unknown file extension in a bundle:** skip with a logged warning naming the file; do not silently include or fail the whole ingest.
- **Unicode in language input (umlauts, accents):** must round-trip cleanly through SQLite + HTML rendering.

## Requirements *(mandatory)*

The following are normative-by-summary; any conflict with the PRD is resolved in favor of the PRD.

### Functional Requirements

- **FR-001**: System MUST package as a **pure Claude Code skill** at `~/.claude/skills/chiron/` (symlink to `chiron/skill/`). The skill is markdown + prompts + light TypeScript scaffolding (file copying, SQLite init, HTML assembly, Zod schema validation). It does **NOT** make direct API calls to Anthropic or Google — the parent Claude Code agent does all text-LLM work natively, and Gemini access is via MCP only (FR-036). The skill is invoked by **two parallel entry-point styles** declared in `SKILL.md`:
  - **(a) Natural-language trigger phrases** for conversational invocation, including at minimum: `teach me <X>`, `make a course on <X>`, `make a lesson out of <X>`, `lesson from this PDF`, `case-study this`, `explain the pattern`, plus the bare keyword `chiron` as an unambiguous fallback.
  - **(b) Slash-commands** for explicit invocation, including at minimum: `/chiron` (auto-detect domain + mode), `/chiron-code`, `/chiron-medicine`, `/chiron-language` (Italian in v1), `/chiron-research-paper`, and `/chiron-case-study` (force Mode B).
  Both styles MUST resolve to the same underlying pipeline. The slash-command form bypasses the Mode A/B heuristic when a mode-specific command is used (e.g. `/chiron-case-study` forces Mode B regardless of input length). (PRD §3 #1, §10)
- **FR-002**: System MUST support four v1 domains co-equally: code, medicine, language-it (Italian), and research-paper. Italian is the v1 language; German (`language-de`) is deferred to post-v1 (Phase 11). Domain selection comes from per-domain trigger phrases or explicit flag. (PRD §1, §4 — Italian/German swap recorded in Clarifications)
- **FR-003**: System MUST select between Mode A (scroll-modules) and Mode B (case-study) using the heuristic: input <2000 words → Mode B candidate; ≥2000 → Mode A candidate. The user MAY override with `mode a` / `mode b`. The inferred mode and one-line reason MUST be shown. (PRD §3 #2, §5.1)
- **FR-004**: For Mode B inputs, system MUST delegate to the existing system-wide skill at `~/.claude/skills/case-study.md`. (PRD §13 Phase 6)
- **FR-005**: System MUST run a five-stage pipeline per lesson: Stage 0 Ingest → Stage 1 Brief → Stage 2 Syllabus → Stage 3 Validate → Stage 4 Build → Stage 5 Assemble. (PRD §9.1)
- **FR-006**: System MUST validate every generated `ChapterSyllabus` against (a) Zod schema, (b) the domain's concept DAG, and (c) a rubric check; on failure, retry up to 3 times with structured issue feedback before aborting the chapter. (PRD §9.1 Stage 3)
- **FR-007**: For the medicine domain ONLY, system MUST run the QUEST-AI 3-stage verifier loop (Generate → Verify → Refine) on every chapter before HTML assembly. The verifier loop is opt-in for other domains. (PRD §3 #6, §13 Phase 4)
- **FR-008**: System MUST express curricula and widgets as TypeScript discriminated unions validated at runtime by Zod — NOT as a string-templating DSL. (PRD §3 #5)
- **FR-009**: System MUST author lessons as multi-file templates (per PRD §10 file layout) and deliver as a single self-contained `lesson.html` that opens with no build step. (PRD §3 #9, §12 SC#5)
- **FR-010**: System MUST initialize a SQLite database at `<lesson-output-dir>/.chiron-state.db` with the schema in PRD §8 (quiz_attempts, mastery, chapter_completion, weakness_log, llm_usage, llm_cache, sr_cards, sr_review_log, bookmarks, plus `_chiron_meta` for migrations).
- **FR-011**: System MUST own spaced repetition end-to-end via SM-2 in `lib/sr-scheduler.ts`. SR review experience MUST surface inline at the top of `lesson.html` on re-open — NOT require app-switching to Anki. (PRD §3 #goal, §5.5, §12 SC#6)
- **FR-012**: System MAY provide an optional one-way `.apkg` Anki export for users who want mobile review. Anki MUST NOT be the primary store. (PRD §1, §5.5, §12 SC#9)
- **FR-013**: System MUST persist quiz attempts, mastery, chapter completion, weakness patterns, bookmarks, and scroll position; re-opening a lesson MUST restore scroll position and surface due SR cards. (PRD §8, §12 SC#6, §12 SC#8)
- **FR-014**: *(REVERSED by Clarification Q8)* — Chiron is skill-driven; there is no in-tree LLM gateway, no `lib/llm.ts`, no sha256 cache, no `llm_usage` / `llm_cache` SQLite tables. The parent Claude Code agent makes text-LLM calls in its own context as it executes the skill. Gemini calls happen via MCP (`mcp__gemini-mcp__*`). Reverses PRD §3 #8 and §11.
- **FR-015**: *(REVERSED by Clarification Q8)* — No in-tree cost guard. Cost visibility is whatever Claude Code surfaces natively for the parent session plus whatever Gemini MCP reports inline. Reverses PRD §3 #12 and §13 Phase 10.
- **FR-016**: System MUST source-ground all generated content in the user-supplied source. Web search and model priors are SUPPLEMENTARY context only. Medicine content without an explicit source MUST refuse to generate rather than fabricate. (Constitution Principle IV)
- **FR-017**: System MUST NOT include any third-party telemetry, analytics, secret-scanning service, or remote logging. All generation runs locally with the user's own API keys. (Constitution Principle V; PRD §3 #8)
- **FR-018**: System MUST support widget types as defined in PRD §6 `WidgetSpec`, including `mcq`, `mcq-clinical-vignette`, `true-false`, `fill-blank` (with fuzzy umlaut/accent matching), `matching-pair`, `cloze`, `spot-the-bug`, `agreement-matrix`, `assertion-reason`, `confidence-weighted`, `slider-estimation`, `boss`, plus renderable widgets `chemical-reaction` (MathJax+mhchem), `molecule-2d` (rendered via an abstract `MoleculeRenderer` interface — concrete library Kekule.js vs RDKit-JS deferred to Phase 4 prototype, see FR-031), `pathway-diagram`, `mermaid`, `mathjax`, `reactive-math` (ChalkAI on-demand), `code-runner` (Pyodide), `forest-plot`, and `audio-tts`.
- **FR-019**: For medicine, every quiz of type `mcq-clinical-vignette` MUST include vignette stem, `keyInfo` tags, leading question, 5 options, per-distractor explanation, Hammer difficulty 1-5, and Attending Tip. Lesson generation for a medicine topic MUST produce 15-20+ vignettes spanning the taxonomy (classic / atypical / pediatric / elderly / immunocompromised / pregnancy / comorbidity / mimicker). (PRD §4, §5.2, §12 SC#2)
- **FR-020**: For language domains, fill-blank grading MUST treat accent/umlaut variants as equivalent (e.g. `caffe` ≡ `caffè`, `e` ≡ `è` for Italian; `ueber` ≡ `über` when German is added post-v1) per the widget's `fuzzyMatch` field.
- **FR-021**: Every quiz-type widget MUST carry a `variants[]` array; at runtime, one variant is randomly merged over the base to produce a fresh attempt per render. (PRD §6 anti-gaming)
- **FR-022**: Each chapter MUST declare ≥3 `scienceAnnotations` covering distinct cog-sci principles. From chapter 8 onward, each chapter MUST declare 2-4 `spacingConnections` referencing earlier chapters. (PRD §5.4)
- **FR-023**: At end of each chapter, system MUST summarize "what user struggled with" into 3 bullets and pass them into the next chapter's persona prompt (pseudo-stateful peer learning). No SQLite-backed misconception engine in v1. (PRD §3 #10, §5.3)
- **FR-024**: System MUST support theme parameterization via CSS custom properties (`themes/_tokens.css`) with at least: `warm-paper` (default), `midnight`, `ocean`, `clinical`, `linguistic`. Theme is auto-picked by domain (code → warm-paper, medicine → clinical, language → linguistic, research-paper → warm-paper) and overridable via `--theme <id>`. The chosen theme's tokens MUST be injected into the chapter-generation system prompt so the LLM produces theme-portable content using `var(--color-...)`. (PRD §7)
- **FR-025**: New domains MUST be addable by dropping `concepts/<domain>.json`, `curricula/<domain>.json`, and `personas/<domain>.json` (plus an optional prompt-template variant) into the skill directory — with NO modifications to TS source under `lib/`, `ingest-adapters/`, or `shell/`. (PRD §3 #3, §4 extensibility, §12 SC#7)
- **FR-026**: System MUST provide an eval rig with 4 golden inputs at `tests/golden-inputs/` (one per v1 domain: code-small-repo, medicine-pneumonia, language-it-passato-prossimo, research-paper-jones2025), snapshot key fields per output, and a `test.sh` regression script that runs all 4 and diffs against snapshots. (PRD §3 #7, §13 Phase 9)
- **FR-027**: The HTML output, the `.chiron-state.db`, and any optional `.apkg` MUST be self-contained in the lesson output directory; the lesson MUST open from any path on disk and any machine without a server.
- **FR-028**: System MUST emit per-stage progress to the console during generation (Stage 0 Ingest → Stage 1 Brief → Stage 2 Syllabus → Stage 3 Validate → Stage 4 Build chapter N/M → Stage 5 Assemble) so the user can see liveness throughout the run. There is NO wall-clock abort on generation duration; the $25 cost guard (FR-015) is the sole runtime backstop.
- **FR-029**: System MUST NOT silently invoke Gemini `start_deep_research` (or any equivalent multi-minute async research call) to enrich lesson content. Deep-research calls are gated behind explicit user request (e.g. "expand on <secondary topic>", "go deeper on X") and MUST be limited to **at most one** deep-research call per lesson generation. Default behavior is to never call it. Quick grounded-search calls (e.g. `gemini_research` synchronous) are not subject to this restriction but should remain rare.
- **FR-030**: For PDF-sourced lessons (medicine textbook chapters, research papers), system MUST copy the source PDF into `<lesson-output-dir>/source/` at ingest time so the lesson directory is fully self-contained and reproducible from one folder. This applies equally to other file-based sources (vocab CSVs, transcript files); web URLs and code repos are referenced by URL/path. PHI/privacy is not a concern in v1 — Chiron is a solo personal-use tool.
- **FR-031**: System MUST expose an abstract `MoleculeRenderer` interface in `lib/chemistry-renderer.ts` for `molecule-2d` widget rendering. The concrete implementation (Kekule.js or RDKit-JS) is selected during Phase 4 prototyping per PRD §14 Q1. Tasks, tests, and downstream code MUST target the interface rather than a specific library. The selected library MUST be a single dependency at runtime — Chiron does NOT ship both.
- **FR-032**: System MUST support the following lesson input source types (full scope per Clarifications Q6):
  - **(a) Text-based PDF** — single PDF with extractable text layer (current `pdf.ts` adapter).
  - **(b) Scanned/image-only PDF** — PDF whose pages are images with no text layer. Each page is exported to a temporary image and sent through Gemini `interpret_image`; reverses R-04's "out of scope" decision.
  - **(c) Image folder** — a directory containing page images (`*.png`, `*.jpg`, `*.jpeg`, `*.webp`) ordered alphabetically; treated as one source. Each image is sent through Gemini `interpret_image` for text + figure interpretation.
  - **(d) Image file (single)** — one image of a page, diagram, X-ray, ECG strip, gross-pathology photo, or equation; extracted via Gemini `interpret_image`.
  - **(e) Multi-PDF chapter** — multiple PDFs (`part1.pdf`, `part2.pdf`, `appendix.pdf`) supplied as an ordered list or directory; concatenated into one logical source before Stage 1 Brief.
  - **(f) Code repository** — git repo, local dir, or single source file (existing `code-repo.ts`).
  - **(g) Vocabulary CSV** — language-domain vocab list (existing `vocab-list.ts`).
  - **(h) Transcript file** — chat/meeting/lecture transcript, plain text or markdown (existing `transcript.ts`).
  - **(i) URL** — single web page; fetched, sanitized, text-extracted (existing `url.ts`).
  - **(j) Standalone HTML file** — local `.html` file; same processing as URL after disk read.
  - **(k) Agent-report** — markdown or JSON file produced by another agent (Gemini deep-research export, prior `case-study` skill output, brainstorm transcripts, agent summaries). Treated as authored secondary content; the lesson grounds in it but flags its provenance in `Brief.metadata.agentSourceProvenance`.
  - **(l) Mixed-source bundle** — a directory containing any combination of the above. The bundle's manifest is implicit (every file recognized by extension is included) or explicit via an optional `chiron.manifest.json` declaring source order and per-file role (`primary`, `supplement`, `figure`, `appendix`).

  System MUST refuse formats it cannot recognize with a clear error listing what was supplied and what would have been recognized — never silently skip.
- **FR-033**: For all vision-extraction paths (FR-032 b/c/d and figure interpretation in any path), system MUST route through the **Gemini `mcp__gemini-mcp__interpret_image` MCP tool** — NOT a direct Google SDK call, NOT Anthropic vision, NOT a third-party OCR vendor. Image-extraction calls are logged inline by Claude Code / the MCP server (FR-014 was reversed; no in-tree `llm_usage` table). The number of images interpreted MUST be visible to the user during Stage 0 progress reporting (FR-028) so they can interrupt if a bundle is unexpectedly large.
- **FR-034**: For `mixed-source bundle` ingest (FR-032 l), Chiron MUST produce one logical `Brief` whose `extractedText` is the ordered concatenation of per-file extractions (text PDFs verbatim, vision-extracted images interleaved at their declared order). Per-file provenance MUST be preserved in `Brief.metadata.sourceManifest[]` so generated content can cite the originating file when relevant.
- **FR-035**: For `agent-report` ingest (FR-032 k), Chiron MUST mark the source as `secondary` in the Brief and require at least one `primary` source if the lesson is medical or research-paper domain — the QUEST-AI verifier and source-grounding rules (FR-007 / FR-016) treat agent-generated reports as supplemental, never the sole grounding for medical claims.
- **FR-036**: System MUST treat the **Gemini MCP toolset** as part of its operating environment and document it in `SKILL.md`. The relevant Gemini MCP tools available to the buildout / runtime agent are:

  | MCP tool | Purpose in Chiron | When invoked |
  |---|---|---|
  | `mcp__gemini-mcp__interpret_image` | Vision extraction — scanned PDF pages, image folders, single images, figures (ECG, X-ray, diagrams, equations) | Stage 0 Ingest, vision path (FR-033) |
  | `mcp__gemini-mcp__gemini_research` | Quick grounded search to verify a fact or fetch a missing definition for a chapter | Stage 4 Build, only when a generated chapter has an unresolvable factual gap; rare |
  | `mcp__gemini-mcp__start_deep_research` | Async deep-research expansion on a secondary topic | Only when user explicitly asks ("expand on X", "go deeper on Y"); ≤1 per lesson (FR-029) |
  | `mcp__gemini-mcp__check_research_status` / `get_research_results` | Poll + retrieve a previously-started deep-research task | Pairs with the above |
  | `mcp__gemini-mcp__save_research_to_markdown` | Persist a deep-research result alongside the lesson source | When a deep-research call lands, save the markdown into `<lesson-output-dir>/research/` |
  | `mcp__gemini-mcp__estimate_research_cost` | Pre-flight cost estimate before invoking `start_deep_research` | Optional; useful before a heavy expansion |
  | `mcp__gemini-mcp__gemini_brainstorm` | Generate alternative lesson plans / persona dialogue when the agent feels stuck | Stage 2 Syllabus or Stage 4 Build, sparingly |
  | `mcp__gemini-mcp__gemini_code_review` | Sanity-check generated code in code-domain lessons | Stage 4 Build, code domain only |
  | `mcp__gemini-mcp__watch_video` | (Future, not v1) — ingest video lectures as a source type | Reserved for post-v1 |
  | `mcp__gemini-mcp__ask_gemini` | General second opinion when no specialized tool fits | Rare; prefer the specialized tools above |

  Other MCP servers are also fair game when a lesson genuinely needs them — e.g. `mcp__context7-mcp__query-docs` for fetching current library documentation in code-domain lessons. SKILL.md MUST list at minimum the Gemini MCP tools above so the buildout agent knows what's at its disposal without re-discovering them.
- **FR-037**: Runtime libraries used by the rendered `lesson.html` MUST be vendored into `chiron/skill/shell/vendor/` and inlined into the single output HTML at Stage 5 Assemble. The vendored set covers (at minimum):
  - **MathJax + mhchem** (chemistry equations, math typesetting)
  - **Mermaid** (flowcharts, sequence diagrams, simple pathway diagrams)
  - **The chosen `MoleculeRenderer` library** (Kekule.js or RDKit-JS; concrete pick deferred to Phase 4 per FR-031)
  - **Forest-plot rendering** (small custom JS; or a vendored mini-lib if one is chosen)
  - **The codebase-to-course HTML shell + CSS** (already forked into `chiron/skill/shell/` per PRD §10)
  - **ClassBuild theme tokens** (already ported into `chiron/skill/shell/themes/` per PRD §7)

  **Pyodide is the only runtime library exempt from FR-037** — its bundle size (~8MB) makes inlining impractical, and only the `code-runner` widget with `runtime: 'pyodide'` exercises it. Pyodide loads lazily from CDN when present; if offline, the `code-runner` widget falls back to a "Pyodide unavailable" message and the rest of the lesson renders fully (R-03).

  Vendored libraries MUST be checked into the repo (not pulled at lesson-generation time from the network) so the skill itself is reproducible. Library version updates are manual + intentional, not silent.

### Key Entities *(include if feature involves data)*

- **Brief** — unified intermediate representation produced by Stage 1 from any source; per-domain adapters fill it. Inputs to syllabus generation. Pure data, in-memory + persisted as JSON sidecar.
- **ChapterSyllabus** — typed-schema-validated chapter plan: `narrative`, `keyConcepts`, `widgets[]` (WidgetSpec), `scienceAnnotations[]` (≥3), `spacingConnections[]` (≥2 from chapter 8+).
- **WidgetSpec** — discriminated-union widget descriptor (see FR-018). Carries `variants[]` for anti-gaming. Rendered by `lib/widget-renderer.ts`.
- **ConceptDAG** — per-domain JSON file under `concepts/`; nodes are concept IDs, edges are prerequisite relationships. Used by validator (FR-006) and curriculum sequencing.
- **Curriculum** — per-domain JSON file under `curricula/`; defines chapter scaffolding, target counts, and template style (e.g. `medicine-amboss` vs `medicine-uptodate`).
- **Persona** — per-domain JSON file under `personas/`; defines peer-learners, domain expert, and (for language) native speaker.
- **Theme** — TypeScript record of CSS-custom-property values; injected into LLM system prompt so generated HTML uses `var(--...)` not hardcoded hex.
- **QuizAttempt** — `(course_id, chapter_id, question_id, variant_id, selected_answer, correct, confidence, timestamp)` — full attempt history.
- **MasteryScore** — `(course_id, concept_id, score, last_reviewed_at)` — decay-aware 0.0-1.0 mastery per concept.
- **SRCard** — spaced-repetition card with SM-2 state (`ease_factor`, `interval_days`, `repetitions`, `next_due_at`, `suspended`); reviewed via `sr_review_log`.
- **Bookmark** — `(course_id, chapter_id, scroll_position, last_visited_at, note)` — drives resume.
- **LLMUsageRecord** — every LLM call logged with model, tokens, cost, request hash, cache_hit flag, status, error. Cache hits MUST be logged with `cache_hit=1` and zero token cost.
- **WeaknessLogEntry** — `(course_id, concept_id, error_pattern, timestamp)` — feeds future interleaving and the next-chapter pseudo-state summary.

## Success Criteria *(mandatory)*

The PRD §12 enumerates 9 ship criteria; the speckit-required measurable outcomes below are derived from them and re-expressed in user-facing, technology-agnostic terms.

### Measurable Outcomes

- **SC-001**: A learner can generate an Italian vocab lesson, including fill-blank with fuzzy accent grading, cloze cards, Maria native-speaker TTS dialogue, and inline SR review on re-open. (PRD §12 #1, adapted — German→Italian swap)
- **SC-002**: A learner can generate a USMLE/AMBOSS-style hypertension or pneumonia lesson with at least 15 clinical-vignette MCQs, each carrying vignette + lab values + leading question + 5 options + per-distractor explanations + Hammer rating + Attending Tip + keyInfo tags. (PRD §12 #2)
- **SC-003**: A learner can generate a code-repo lesson with side-by-side code+English exposition, spot-the-bug quizzes, and AI peer-learner discussion of an architectural choice. (PRD §12 #3)
- **SC-004**: A learner can generate a research-paper lesson from an arbitrary PDF covering motivation / methods / results / discussion / critical appraisal / connections, with comprehension MCQs and at least one forest-plot visualization. (PRD §12 #4)
- **SC-005**: All four golden lessons render in a browser by opening `index.html` directly — no build step, no server, no required network beyond optional CDN assets that are not core to content. (PRD §12 #5)
- **SC-006**: Re-opening any lesson restores scroll position, marks completed chapters, and surfaces due SR cards inline at the top of the page within 1 second on a typical laptop. (PRD §12 #6)
- **SC-007**: A new domain can be added by authoring 3 JSON files (concepts, curricula, personas) and at most one prompt-template variant — no source file under `lib/`, `ingest-adapters/`, or `shell/` is modified. A trivial new-domain lesson generates successfully on first try. (PRD §12 #7)
- **SC-008**: Learner state (quiz attempts, mastery, completion, weakness, bookmarks, SR cards) survives across sessions — closing the browser and re-opening the file the next day shows the same state. (PRD §12 #8)
- **SC-009**: Optional `.apkg` Anki export produces a file importable into Anki Desktop without errors, preserving cloze/term-def/vignette card types. (PRD §12 #9 — stretch goal)
- **SC-010**: *(REVERSED by Clarification Q8)* — Cost is not tracked in-tree. Visibility is whatever Claude Code surfaces natively for the parent session plus any cost lines the Gemini MCP server prints. The user is in control of the parent session and can interrupt at any time.
- **SC-011**: For medicine, every chapter passes the QUEST-AI verifier (Stage 2) before HTML assembly; chapters that fail to refine within 3 attempts are aborted with a structured issue report rather than shipped silently.
- **SC-012**: Generation surfaces per-stage progress to the console such that no period of >30 seconds passes silently during a typical run; the user can see which stage and (during Stage 4) which chapter is currently in progress.
- **SC-013**: Across the four golden-input regression runs (FR-026), `start_deep_research` is invoked zero times by default. Any deep-research call during a real generation is preceded by an explicit user request in the conversation log; aggregate count never exceeds one per lesson.
- **SC-014**: A learner can supply a scanned (image-only) PDF of a textbook chapter and Chiron generates a working lesson — text and figure content extracted via Anthropic vision, lesson opens in browser, SR cards persist (FR-032 b).
- **SC-015**: A learner can supply a folder containing 30 page-image files (`page-001.png` … `page-030.png`) and Chiron treats it as one chapter source — alphabetic ordering preserved, ordered concatenation visible in `brief.json` (FR-032 c, FR-034).
- **SC-016**: A learner can supply a mixed-source bundle (text PDF + 5 images + an agent-generated markdown report) and Chiron produces a lesson whose `Brief.metadata.sourceManifest[]` captures all files with correct provenance, and whose generated content respects FR-035 (agent-report is supplemental, not sole grounding for medicine).
- **SC-017**: When an unrecognized file extension appears in a bundle, the ingest log emits a clear warning naming the file; the rest of the bundle ingests successfully.

## Assumptions

- **Audience**: A single solo learner — Gyasi. No multi-user, no auth, no multi-tenant infra. Persistence is per-lesson SQLite, not a shared DB. (Constitution Principle II)
- **API keys**: Per Clarification Q8, Chiron is skill-driven and does NOT use a direct `ANTHROPIC_API_KEY` of its own. Anthropic access is whatever the parent Claude Code session uses. Gemini access is via the user's already-configured `mcp__gemini-mcp__*` MCP server (the user's existing `GEMINI_API_KEY` configured for the MCP server). No new key setup is required for v1.
- **Heritage repos**: `~/dev/audits/codebase-to-course/`, `~/dev/audits/classbuild/`, and `~/dev/audits/ai-course-generator/` are locally cloned for fork/port purposes during buildout.
- **Mode B sibling skill**: `~/.claude/skills/case-study.md` exists and is invocable; Chiron's Mode B path delegates to it rather than re-implementing.
- **German language**: Deferred to post-v1 (Phase 11). v1 ships Italian only as the language-domain representative — the Italian/German swap is intentional and recorded in Clarifications. (Reverses PRD §13 defer-list ordering.)
- **Voice input / image input**: Out of scope for v1 (PRD §13 Defer list).
- **MCP packaging / OpenTelemetry / per-stage budgets**: Explicitly deferred (PRD §3 #1, §3 #8, §3 #12).
- **Chemistry rendering library**: Decision between Kekule.js and RDKit-JS deferred to Phase 4 prototyping (PRD §14 Q1). Code targets an abstract `MoleculeRenderer` interface (FR-031); the concrete library is a single Phase-4 selection.
- **TTS provider**: Gemini TTS is the default; ElevenLabs is a fallback if Gemini quality is insufficient (PRD §14 Q4).
- **PDF ingestion**: Text-based PDFs only in v1. Scanned/image-only PDFs are out of scope.
- **Cost model**: *(removed per Clarification Q8)* — no in-tree cost model. The user sees Claude Code's native cost reporting and can interrupt the parent session when satisfied.
- **Browser compatibility**: Modern Chromium-based browser is the target; no IE/legacy support.
- **Threats deferred**: No PHI / HIPAA constraints — this is a personal solo-learner tool, not a clinical product. Medical accuracy is enforced via verifier loop and source-grounding (FR-016), not regulatory compliance. Source PDFs are copied into the lesson output dir for reproducibility (FR-030); the user is responsible for not feeding Chiron material they don't have rights to retain locally.

## References

- **PRD (source of truth)**: [`prd/chiron_design_v1_2026-04-28.md`](../../prd/chiron_design_v1_2026-04-28.md)
- **Tracking PRD**: [`prd/universal_lesson_generator_2026-04-28.md`](../../prd/universal_lesson_generator_2026-04-28.md)
- **Constitution**: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
- **Memory bank** (research/planning context): `memory-bank/projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`, `follow_ups.md`
- **Heritage audits**: `~/dev/audits/codebase-to-course/`, `~/dev/audits/classbuild/`, `~/dev/audits/ai-course-generator/`
- **Sibling skill**: `~/.claude/skills/case-study.md`
