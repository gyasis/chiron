# Implementation Plan: Chiron v1 — Universal Lesson Generator

**Branch**: `001-chiron-v1` | **Date**: 2026-04-28 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `specs/001-chiron-v1/spec.md`
**Source of truth (design)**: [`prd/chiron_design_v1_2026-04-28.md`](../../prd/chiron_design_v1_2026-04-28.md)

## Summary

Chiron is a single Claude Code skill that turns any subject — code repos, medicine textbook chapters, Italian-language vocab/grammar, research-paper PDFs — into a self-contained interactive HTML lesson with quizzes, AI peer-learner personas, optional chemistry / forest-plot / Mermaid visualizations, and built-in spaced-repetition retention. v1 ships four co-equal domains (code, medicine, language-it, research-paper). German is deferred to post-v1. Output is a single `lesson.html` that opens in any browser with no build step, plus a sibling SQLite at `<lesson-dir>/.chiron-state.db` for resume + SR scheduling. Generation runs locally with the user's own API keys; no telemetry. Most architectural decisions are locked in PRD §3 (12 locked decisions); this plan translates them into a Phase-0/Phase-1 artifact set and validates them against the constitution.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) — used for non-LLM scaffolding only (file copying, SQLite init, HTML assembly, Zod schema validation). All text-LLM work is done by the parent Claude Code agent natively (Q8).
**Primary Dependencies**:
  - **No `@anthropic-ai/sdk`** — Q8 reversed PRD §11; Chiron is skill-driven, the parent Claude Code agent does text-LLM work in its own context.
  - **MCP tools** (invoked from inside the running skill, not as Node deps):
    - `mcp__gemini-mcp__interpret_image` — vision extraction (FR-033)
    - `mcp__gemini-mcp__gemini_research` — quick grounded search (rare, FR-036)
    - `mcp__gemini-mcp__start_deep_research` + `check_research_status` + `get_research_results` + `save_research_to_markdown` — opt-in deep research, ≤1 per lesson (FR-029, FR-036)
    - `mcp__gemini-mcp__estimate_research_cost` — pre-flight estimate before deep research
    - `mcp__gemini-mcp__gemini_brainstorm` / `gemini_code_review` / `ask_gemini` — sparingly per FR-036
    - `mcp__context7-mcp__query-docs` — for fetching current library docs in code-domain lessons
  - **Node-side TS deps** (small, scaffolding only): `zod` (Zod schemas for the WidgetSpec / ChapterSyllabus / Brief types), `better-sqlite3` (synchronous SQLite for SR cards / mastery / bookmarks / quiz attempts), `pdfjs-dist` (text-layer extraction from text PDFs), `pdf-to-img` or equivalent (rasterize scanned PDF pages before passing to `interpret_image`).
  - **Vendored runtime libraries** (per FR-037 — checked into `chiron/skill/shell/vendor/`, inlined into `lesson.html` at Stage 5):
    - MathJax + mhchem (chemistry)
    - Mermaid (diagrams)
    - The chosen `MoleculeRenderer` (Kekule.js or RDKit-JS — Phase 4 prototype picks one per FR-031)
    - Forest-plot rendering (small custom JS or a vendored mini-lib)
    - The codebase-to-course HTML shell + CSS + ClassBuild theme tokens (already forked / ported per PRD §7, §10)
  - **Lazy-CDN runtime** (NOT vendored, exempt from FR-037 due to size): Pyodide (~8MB, only loaded if `code-runner` widget with `runtime: 'pyodide'` is present per R-03). Falls back to "Pyodide unavailable" message if offline.
  - **TTS** via Gemini API (Italian native-speaker persona); ElevenLabs as fallback if Gemini quality insufficient. TTS is also via MCP if the project's MCP server exposes it; otherwise the skill produces a transcript and Gemini's TTS produces the audio file at Stage 4 (R-01).
**Storage**: SQLite at `<lesson-output-dir>/.chiron-state.db` (per-lesson, single learner). Schema covers `quiz_attempts`, `mastery`, `chapter_completion`, `weakness_log`, `sr_cards`, `sr_review_log`, `bookmarks`, plus `_chiron_meta` (schema_version) for migrations. **`llm_usage` and `llm_cache` are NOT created** (Q8 — no in-tree LLM call tracking). Source PDFs/images/CSVs copied into `<lesson-output-dir>/source/` (FR-030).
**Testing**: Lightweight regression rig (PRD §3 #7): 4 golden inputs at `tests/golden-inputs/` (one per domain — code-small-repo, medicine-pneumonia, language-it-passato-prossimo, research-paper-jones2025), per-output snapshots of key fields (chapter count, quiz count, persona-dialog count, SR-card count), plus a `test.sh` driver that runs all 4 and diffs snapshots. No full skill-creator pipeline (Executor/Grader/Comparator/Analyzer) — explicitly rejected as procrastination per PRD §3 #7. Zod schemas double as runtime contracts and unit-test fixtures.
**Target Platform**: Modern Chromium-based browser (HTML lesson consumer side); Node 20+ (skill author side, run inside Claude Code). No mobile/native targets.
**Project Type**: Single-project — Claude Code skill bundle. Skill lives at `chiron/skill/` (symlinked to `~/.claude/skills/chiron/`). Not a library, not a web service, not a CLI in the traditional sense.
**Performance Goals**: Soft cap with per-stage progress reporting (FR-028, SC-012) — no >30s of silent run time. Re-open <1s on a typical laptop (SC-006). Generation wall-clock is variable; medicine with 15-20 vignettes naturally takes longer than code lessons. **No in-tree cost guard** (Q8 reversed FR-015) — the user controls the parent Claude Code session and can interrupt at any time.
**Constraints**: Self-contained local output (Constitution V, FR-009/FR-017/FR-027): single `lesson.html` opens with no build step, no server, no telemetry. Source-grounded (Constitution IV, FR-016): user-supplied source is primary; web search supplementary; medicine without source MUST refuse. Single learner (Constitution II): no auth, no multi-tenant. Deterministic progression (Constitution III, FR-005/FR-006): concept DAG + 5-stage pipeline; LLM only generates + grades. Gemini `start_deep_research` capped at 1 call per lesson, opt-in only (FR-029, SC-013).
**Scale/Scope**: 4 domains × 4 golden lessons. Per-lesson chapter count ~6-15 (typical). Per-chapter quiz volume by domain — code 8-12, medicine **15-20+** vignettes, language 30-50 cloze/fill-blank, research-paper 5-10 (PRD §4). SR cards per chapter — code 5-10, medicine 10-20, language 30-50, research-paper 8-12. Single user, no concurrent-write contention. Adding a new post-v1 domain requires only 3 JSON files (concepts, curricula, personas) per FR-025.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) v1.0.0.

| Principle | Status | Evidence |
|---|---|---|
| **I. Three Co-Equal Domains** | ✅ PASS | Spec ships 4 co-equal domains (code, medicine, language-it, research-paper). Per-domain assessment formats locked in FR-018/-019/-020 — medicine vignettes mandated, language fuzzy accent matching mandated, code spot-the-bug mandated. Italian/German swap (Clarification Q1) does not change the principle — still one language domain co-equal with the others. |
| **II. Solo Learner with Multi-Persona Content** | ✅ PASS | FR-010: SQLite per lesson, no Postgres. FR-011: SR owned end-to-end via SQLite, no multi-tenant. AI personas (Alice/Bob/Mike/Priya/Maria/Dr. Reyes/Dr. Hofmann) are content-layer features per FR-023 — not a multi-user system. No auth, no remote DB. |
| **III. LLM as Advisor, Not Arbiter** | ✅ PASS | FR-005: explicit 5-stage pipeline. FR-006: Zod schema + concept-DAG + rubric validator with 3-attempt retry. FR-008: TypeScript discriminated unions, not a DSL. LLM generates content into typed slots and grades attempts; progression is deterministic. **Q8 reinforces this**: even the LLM call site is now external (parent Claude Code) — Chiron's TS code is purely deterministic scaffolding. |
| **IV. Source-Grounded Generation** | ✅ PASS | FR-016: user-supplied source is primary; web search supplementary; medicine without source MUST refuse. FR-029 caps `start_deep_research` to opt-in, ≤1/lesson — prevents silent ungrounded enrichment. FR-007: medicine-only QUEST-AI verifier loop catches hallucinations. |
| **V. Self-Contained Local Output, Zero Telemetry** | ✅ PASS (strengthened by Q9) | FR-009/-027: single `lesson.html`, no build step, no server. FR-017: no third-party telemetry/analytics/remote logging. **FR-037 (Q9) vendored runtime libraries** mean the lesson opens with **no CDN calls** for everything except the optional Pyodide widget — actually delivering "open `index.html` and it works offline." Q8 removed the in-tree LLM gateway entirely; cost/usage logging is whatever Claude Code surfaces, no in-tree telemetry. |

**Result**: All 5 principles pass. **No violations to justify.** Complexity Tracking section omitted.

## Project Structure

### Documentation (this feature)

```text
specs/001-chiron-v1/
├── plan.md              # This file
├── research.md          # Phase 0 output — resolves the few remaining unknowns
├── data-model.md        # Phase 1 output — entities + Zod-shaped schema + DB layout
├── quickstart.md        # Phase 1 output — how to invoke the skill once Phase 1 ships
├── contracts/           # Phase 1 output — interface contracts (skill triggers, widget schema, DB)
│   ├── skill-triggers.md    # Trigger phrases + slash commands (FR-001)
│   ├── widget-spec.ts       # WidgetSpec discriminated union (FR-018)
│   ├── pipeline-stages.md   # 5-stage pipeline I/O contract (FR-005)
│   └── sqlite-schema.sql    # Full DB schema (FR-010, mirrors PRD §8)
├── checklists/
│   └── requirements.md  # Already created in /speckit-specify
└── tasks.md             # Phase 2 output (NOT created here — that's /speckit-tasks)
```

### Source Code (repository root)

```text
chiron/                              # repo root — already exists
├── README.md
├── CLAUDE.md
├── prd/                             # design source of truth (already populated)
├── memory-bank/                     # research/planning context (already populated)
├── specs/001-chiron-v1/             # this plan + Phase 0/1/2 artifacts
└── skill/                           # the deployable Claude Code skill (NEW — created by tasks)
    ├── SKILL.md                     # entry point: trigger phrases + slash commands + workflow shell
    ├── prompts/                     # per-stage LLM prompt templates (PRD §9.2)
    │   ├── 00-ingest/               # source-type adapter prompts — covers all 12 source types in FR-032
    │   ├── 01-brief.md
    │   ├── 02-syllabus.md
    │   ├── 03-validate-rubric.md
    │   ├── 04a-chapter-write.md
    │   ├── 04b…04q                  # widget-type-specific prompts (mcq, vignette, fill-blank, cloze, …)
    │   ├── 05-answer-balancer.md
    │   └── medicine-only/           # QUEST-AI verifier 3-stage prompts
    ├── ingest-adapters/             # source-type adapters (TS) — FR-032 full scope
    │   ├── code-repo.ts             # (f) git repo / local dir / single source file
    │   ├── pdf.ts                   # (a) text-PDF via pdfjs-dist; (b) scanned-PDF falls through to vision
    │   ├── image.ts                 # (c)(d) image folder OR single image — Anthropic vision
    │   ├── multi-pdf.ts             # (e) ordered list / dir of PDFs concatenated
    │   ├── url.ts                   # (i) web page; (j) standalone .html file
    │   ├── transcript.ts            # (h) chat / meeting / lecture transcript
    │   ├── vocab-list.ts            # (g) language-domain CSV
    │   ├── agent-report.ts          # (k) markdown / JSON output from another agent
    │   └── bundle.ts                # (l) mixed-source folder; honors chiron.manifest.json
    ├── concepts/                    # static concept DAGs per domain (JSON)
    │   ├── code.json
    │   ├── medicine.json
    │   ├── language-it.json         # German DEFERRED post-v1
    │   └── research-paper.json
    ├── curricula/                   # static curriculum templates (JSON)
    │   ├── code.json
    │   ├── medicine-amboss.json
    │   ├── medicine-uptodate.json
    │   ├── language-vocab.json
    │   ├── language-grammar.json
    │   └── research-paper.json
    ├── personas/                    # peer + expert + native-speaker per domain (JSON)
    │   ├── code.json                # Chiron-mentor + Alice + Bob
    │   ├── medicine.json            # Dr. Reyes + Mike + Priya
    │   ├── language-it.json         # Maria + study-group peers
    │   └── research-paper.json      # Dr. Hofmann + Bob
    ├── shell/                       # HTML rendering (forked from codebase-to-course)
    │   ├── _base.html
    │   ├── _footer.html
    │   ├── styles.css               # FORK from codebase-to-course (1195 LOC)
    │   ├── main.js                  # in-lesson SR review surface, scroll-restore, bookmarks
    │   ├── build.sh                 # multi-file → single-file assembler (inlines vendor/* per FR-037)
    │   ├── themes/                  # CSS custom property tokens
    │   │   ├── _tokens.css
    │   │   ├── warm-paper.css       # default
    │   │   ├── midnight.css
    │   │   ├── ocean.css
    │   │   ├── clinical.css         # medicine default
    │   │   └── linguistic.css       # language default
    │   ├── _science-overlay.css     # cog-sci pillar colors
    │   └── vendor/                  # FR-037 — vendored runtime libraries inlined into lesson.html
    │       ├── mathjax/             # MathJax core + mhchem extension (chemistry)
    │       ├── mermaid/             # Mermaid diagrams
    │       ├── molecule-renderer/   # Kekule.js OR RDKit-JS (single dep, Phase 4 picks)
    │       ├── forest-plot/         # custom forest-plot mini-lib for research-paper widget
    │       └── README.md            # version-pinning notes for manual updates
    ├── lib/                         # Q8 — no LLM gateway; only non-LLM scaffolding
    │   ├── validator.ts             # Zod + concept-DAG + rubric checks (FR-006)
    │   ├── sr-scheduler.ts          # SM-2 (~50 LOC, R-07)
    │   ├── theme.ts                 # buildThemePromptBlock + theme registry (FR-024)
    │   ├── widget-renderer.ts       # WidgetSpec → HTML injector
    │   ├── chemistry-renderer.ts    # MoleculeRenderer abstract interface (FR-031) — inlines vendor/molecule-renderer
    │   ├── chalkai-loader.ts        # on-demand ChalkAI runtime
    │   ├── sqlite-init.ts           # schema migration (R-08)
    │   └── apkg-export.ts           # OPTIONAL Anki export (post-v1, SC-009)
    │   # NOTE: llm.ts, answer-balancer.ts removed per Q8 — text-LLM work is parent Claude Code's job
    └── tests/
        ├── golden-inputs/           # 4 reference lessons (one per v1 domain)
        │   ├── code-small-repo/
        │   ├── medicine-pneumonia/
        │   ├── language-it-passato-prossimo/   # NOT german/dative — clarification Q1
        │   └── research-paper-jones2025/
        ├── snapshots/               # expected key-field values per output
        └── test.sh                  # 50-line regression driver
```

**Structure Decision**: Single project, in-tree skill bundle at `chiron/skill/`. The skill is the deployment unit — it is symlinked into `~/.claude/skills/chiron/` for invocation but lives in this repo for source control. No separate frontend/backend split (the "frontend" is the static HTML output the skill emits; the "backend" is the skill-runtime TS code, both in-tree). No `src/`, `apps/`, or `packages/` polyrepo layout — the file tree above mirrors PRD §10 exactly.

## Complexity Tracking

*Constitution Check passed all 5 principles with no violations. Complexity Tracking is intentionally empty.*
