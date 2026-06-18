---
name: chiron
description: |
  Universal LLM-powered lesson generator for solo learners across code, medicine,
  and language. Sources: text, PDFs, code repos, images/book-page photos, VIDEO
  files & YouTube URLs, and AUDIO (lectures/podcasts, transcribed locally via the
  Atelier whisper sidecar). Also runs a phone-camera capture sidecar (snap pages
  on your phone → lesson). Triggers on natural-language phrases ("teach me X",
  "make a course on Y", "lesson from this PDF", "make a lesson from this
  video/audio/recording", "turn this YouTube video into a course", "transcribe
  this lecture into a lesson", "capture pages from my phone", "case-study this",
  "chiron …") AND on slash-commands (/chiron, /chiron-code, /chiron-medicine,
  /chiron-language, /chiron-research-paper, /chiron-case-study). Produces a single
  self-contained lesson.html plus a per-lesson SQLite state DB.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - mcp__gemini-mcp__interpret_image
  - mcp__gemini-mcp__watch_video
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

## ⛔ BLOCKING — NO HARDCODED PALETTES IN GENERATED LESSONS

When emitting `lesson.html`, the parent agent **MUST**:

1. **Copy theme files NEXT TO the lesson, link via `<link>`** — copy
   `skill/shell/themes/_tokens.css` + `themes/{midnight,warm-paper,clinical,linguistic,ocean}.css`
   into `<lesson-output-dir>/themes/`, then add 6 `<link rel="stylesheet">`
   tags. **DO NOT inline theme CSS into the HTML.** Editing one CSS file must
   re-theme the lesson without touching `lesson.html`.
2. **Set `<html data-theme="<theme>">`** with a sensible default
   (medicine→clinical, language→linguistic, code→midnight).
3. **Include the `?theme=…` URL-param + localStorage switcher script**
   so the harness and the user can flip themes at runtime.
4. **NEVER define hardcoded color hex / rgb in `:root`.** All component
   styles MUST consume `var(--chiron-*)` tokens (or a thin alias layer
   that maps to them). This is what makes themes swappable.
5. **Self-check before writing:** `grep -E '#[0-9a-fA-F]{3,6}' lesson.html`
   should return ONLY matches inside theme-block definitions, never inside
   component CSS.

**Reference output that satisfies the contract:**
`~/dev/projects/chiron/lessons/klinefelter-syndrome-2026-05-03/lesson.html`

**Why blocking:** The 2026-05-03 Klinefelter lesson initially shipped with
hardcoded dark colors and bypassed the entire theme system. This rule prevents
recurrence. Any future generation that fails self-check #5 must be refactored
before delivery.

---


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
| `make a lesson from this video` / `<file>.mp4` | Mode A; source = video (Gemini `watch_video`) |
| `turn this YouTube video into a course` / a `youtube.com` URL | Mode A; source = YouTube |
| `make a lesson from this audio/recording/lecture` / `<file>.mp3` | Mode A; source = audio (local whisper) |
| `transcribe this lecture into a lesson` | Mode A; source = audio |
| `capture pages from my phone` / `start the capture server` | runs the G6 capture sidecar |
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

### Rich-media & phone-capture sources (G5 / G6)

Sources are dispatched by file extension / URL — same entry points, just point
them at media. Full guide: **`RICH-MEDIA-GUIDE.md`**.

| Source | Adapter / engine | Notes |
|---|---|---|
| image / book-page photo / screenshot, or a folder of pages | `ingest-adapters/image.ts` → `mcp__gemini-mcp__interpret_image` | medicine = raw description (no dx); language-it = accents preserved |
| video file / YouTube URL | `ingest-adapters/video.ts` → `mcp__gemini-mcp__watch_video` | transcript + visuals; medicine `SUBJECT:` = USMLE body-system/topic/specialty |
| audio file | `ingest-adapters/audio.ts` → **Atelier whisper sidecar** (local, `192.168.0.159:8766`, `large-v3`) | NOT gemini; `CHIRON_WHISPER_URL`/`_MODEL` overridable |
| **phone camera** | `scripts/capture-server.mjs` (standalone Node, LAN) | `node scripts/capture-server.mjs --auto-ingest --domain <d>` → snap → live image-folder Brief |

The Stage-0 adapters are deterministic (copy + emit a handoff sidecar); the
parent agent fulfils the vision/transcription handoff and folds the result into
`brief.json`. The capture server is a plain Node process — it cannot call the
LLM/MCP, so it automates capture → ready workspace, and the agent finishes
(vision OCR + generation). All three domains are first-class for every source.

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
running this skill — there is no in-tree SDK call. Image/video extraction routes
through `mcp__gemini-mcp__interpret_image` / `mcp__gemini-mcp__watch_video`;
audio is transcribed locally by the Atelier whisper sidecar (no LLM/MCP).

## MCP toolset (FR-036)

| Tool | Purpose |
|---|---|
| `mcp__gemini-mcp__interpret_image` | Vision extraction for scanned PDFs, images, image folders, phone captures |
| `mcp__gemini-mcp__watch_video` | Video / YouTube extraction — transcript + visual analysis (G5) |
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
