---
name: chiron
description: |
  Universal LLM-powered lesson generator for solo learners across code, medicine,
  and language. Triggers on natural-language phrases ("teach me X", "make a course
  on Y", "lesson from this PDF", "case-study this", "chiron …") AND on slash-commands
  (/chiron, /chiron-code, /chiron-medicine, /chiron-language, /chiron-research-paper,
  /chiron-case-study). Produces a single self-contained lesson.html plus a per-lesson
  SQLite state DB.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - mcp__gemini-mcp__interpret_image
  - mcp__gemini-mcp__gemini_research
  - mcp__gemini-mcp__start_deep_research
  - mcp__gemini-mcp__check_research_status
  - mcp__gemini-mcp__get_research_results
  - mcp__gemini-mcp__save_research_to_markdown
  - mcp__gemini-mcp__ask_gemini
  - mcp__gemini-mcp__gemini_brainstorm
  - mcp__gemini-mcp__gemini_debug
  - mcp__gemini-mcp__gemini_code_review
---

# Chiron — Universal Lesson Generator

Chiron turns any source — a code repo, a medical PDF, an Italian vocab list, a
research paper — into a self-contained interactive lesson that runs in any
modern browser. It is built around three foundational facts:

1. **Three co-equal domains.** Code, medicine, and language are first-class.
2. **Single learner = Gyasi.** No auth, no multi-tenant. SQLite per lesson.
3. **AI multi-persona content.** Peer-learner dialogue + expert tutor inside
   one solo-learner's lesson. Content-layer feature, NOT a multi-user system.

## Entry points

### Style A — natural-language

| Phrase | Inferred intent |
|---|---|
| `teach me <X>` | Mode A; domain auto-detected |
| `make a course on <X>` | Mode A |
| `make a lesson out of <X>` | Mode auto |
| `lesson from this PDF` | Mode A; source = PDF |
| `case-study this` | Mode B (forced) |
| `explain the pattern` | Mode B (forced) |
| `chiron <…>` | Generic fallback |

### Style B — slash-commands

| Slash-command | Mode | Domain |
|---|---|---|
| `/chiron` | auto | auto |
| `/chiron-code` | A | code |
| `/chiron-medicine` | A | medicine (asks AMBOSS vs UpToDate sub-mode at run time) |
| `/chiron-language` | A | language-it (German is **deferred to post-v1**) |
| `/chiron-research-paper` | A | research-paper |
| `/chiron-case-study` | **B (forced)** | auto |

Both styles produce a `TriggerContext` (see `lib/trigger-context.ts`) and feed
the same 5-stage pipeline.

### German — refuse with clear message

If the user requests `language-de` or any German lesson in v1, respond:

> Chiron v1 supports Italian only on the language axis. German tutoring is
> deferred to post-v1. The blockers are TTS-voice quality validation and the
> verb-conjugation-table widget, both planned for v1.1.

## Mode A vs Mode B

- **Mode A — Course-style.** Multi-chapter scroll-snap lesson, Coursera-feel.
- **Mode B — Case-study-style.** 3-act lecture (Evidence → 2 Lectures → Synthesis).

When neither is forced, the heuristic in `lib/mode-heuristic.ts` decides:
`< 2000 words → Mode B`, `≥ 2000 → Mode A`. Chiron displays the inferred mode
+ one-line reason before generation. The user may override mid-conversation
with "mode a" or "mode b".

## 5-stage pipeline

1. **Ingest** — per-source-type adapter normalizes raw input to `Brief`.
2. **Brief** — Stage-1 prompt enriches the `Brief` with domain metadata.
3. **Syllabus** — Stage-2 prompt fills `ChapterSyllabus[]` schema slots.
4. **Validate** — Zod + concept-DAG + rubric. Up to 3 retries on failure.
5. **Build + Assemble** — Stage-4 prompts populate widgets, Stage-5 inlines
   vendored libs and writes `lesson.html` + `.chiron-state.db`.

Per Q8, every text-LLM call is performed by the parent Claude Code agent
running this skill — there is no in-tree SDK call. Vision extraction routes
through `mcp__gemini-mcp__interpret_image`.

## MCP toolset (FR-036)

| Tool | Purpose |
|---|---|
| `mcp__gemini-mcp__interpret_image` | Vision extraction for scanned PDFs, images, image folders |
| `mcp__gemini-mcp__gemini_research` | Quick grounded supplementary research |
| `mcp__gemini-mcp__start_deep_research` | Deep research — **user opt-in only**, ≤ 1 / lesson (FR-029) |
| `mcp__gemini-mcp__check_research_status` | Poll deep-research task |
| `mcp__gemini-mcp__get_research_results` | Retrieve completed deep-research |
| `mcp__gemini-mcp__save_research_to_markdown` | Save research output into `<lesson-output-dir>/research/` |
| `mcp__gemini-mcp__ask_gemini` | Generic second opinion |
| `mcp__gemini-mcp__gemini_brainstorm` | Divergent options for lesson plan alternatives |
| `mcp__gemini-mcp__gemini_debug` | Diagnose pipeline failures |
| `mcp__gemini-mcp__gemini_code_review` | Code-domain lesson code review pass |

Other MCP servers (e.g. `mcp__context7-mcp__query-docs`) are also fair game
when a lesson needs them.

## Output

Each generated lesson is a self-contained directory:

```
<lesson-output-dir>/
  lesson.html          # single-file site, no build step
  .chiron-state.db     # SQLite — quiz attempts, mastery, SR cards, bookmarks
  brief.json           # Stage 1 sidecar for reproducibility
  syllabus.json        # Stage 2 sidecar
  source/              # copied source files (FR-030)
  audio/               # TTS audio for language lessons
  research/            # deep-research markdown (only when opted in)
```

## Validation

The 4 golden inputs in `tests/golden-inputs/` exercise both entry styles —
at least one natural-language trigger and one slash-command across the rig.
