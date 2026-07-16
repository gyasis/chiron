# Chiron — Universal Lesson Generator

## TL;DR

Chiron is a domain-agnostic LLM-powered lesson generator that turns a source (codebase, textbook chapter, vocab list, research paper, incident report) into a self-contained interactive HTML lesson. It is built for a single solo learner — Gyasi — with code, medicine, and language as co-equal first-class domains. Output is one `lesson.html` you open in any browser, backed by a per-lesson SQLite state file that tracks quiz attempts, mastery, and spaced-repetition cards.

---

## Quick start

Drop a source on Chiron via natural language or a slash command, and you get a lesson directory back.

### Example invocations

```text
# Code lesson from a TypeScript repo
/chiron-code ./my-project

# Italian lesson from a vocab CSV
/chiron-language ./italian-vocab.csv

# Medicine lesson from a textbook chapter PDF
/chiron-medicine ./pneumonia-chapter.pdf

# Research-paper lesson (IMRAD-aware)
/chiron-research-paper ./jones2025.pdf

# Auto-detect (heuristic decides domain + Mode A vs B)
/chiron ./incident-report.md

# Force case-study form
/chiron-case-study ./outage-postmortem.md
```

Natural-language phrasing works equivalently:

```text
teach me hooks in this React repo at ~/code/my-react-app
make a course on community-acquired pneumonia from ~/Downloads/cap-amboss.pdf
make a lesson out of these Italian vocab words from ~/lang/italian-a1.csv
case-study this incident-report.md
```

Both styles produce the same output. The slash-command form pre-fills the domain/mode and bypasses the heuristic.

### Rich-media & phone-capture sources

Beyond text/PDF/repo, Chiron ingests **images, video, YouTube, and audio** — and
can take live **phone-camera captures**. All work across code, medicine, and
language. Full guide: [`RICH-MEDIA-GUIDE.md`](./RICH-MEDIA-GUIDE.md).

```text
# Image / book-page photo / screenshot (Gemini vision)
/chiron-medicine ./harrison-cap-page.jpg

# Video file or YouTube URL (Gemini watch_video — transcript + visuals)
/chiron-code https://www.youtube.com/watch?v=<id>

# Audio — transcribed LOCALLY by the Atelier whisper sidecar (no cloud)
/chiron-language ./podcast-italiano.m4a

# Phone camera → lesson: start the sidecar, snap pages on your phone
node skill/scripts/capture-server.mjs --auto-ingest --domain medicine
```

### One-time setup

```bash
ln -s ~/dev/projects/chiron/skill ~/.claude/skills/chiron
```

No API keys to set for Chiron itself — the skill uses the parent Claude Code session for text-LLM work, and the already-configured Gemini MCP server for `interpret_image`, optional `gemini_research`, opt-in `start_deep_research`, and Italian TTS.

### Re-opening a lesson

Just open `lesson.html` again. The page reads `.chiron-state.db`, restores scroll position, marks completed chapters, and surfaces due SR cards inline at the top (FR-011, FR-013, SC-006).

### Deep-research opt-in

By default, Chiron does NOT call `start_deep_research` (FR-029). Ask for it explicitly during generation:

```text
expand on the renin-angiotensin pathway with deep research
```

Hard cap: one deep-research call per lesson. Results are saved into `<lesson-output-dir>/research/`.

---

## What you get

```text
<lesson-output-dir>/
  lesson.html         # self-contained — open in any browser
  .chiron-state.db    # SQLite — quiz attempts, mastery, SR cards
  brief.json          # Stage 1 sidecar
  syllabus.json       # Stage 2 sidecar
  source/             # copied source files (FR-030)
  audio/              # TTS audio for language lessons (when TTS provider is wired)
  research/           # deep-research sidecar (only when opted in via FR-029)
```

---

## Domains supported in v1

- **Code (US1)** — TypeScript, Python, Go, etc. Concept DAG via `concepts/code.json`.
- **Italian language (US2)** — vocab + grammar. German is post-v1.
- **Medicine (US3)** — AMBOSS or UpToDate sub-mode; QUEST-AI verifier loop for safety-critical content.
- **Research papers (US4)** — IMRAD-aware, forest-plot extraction for meta-analyses.
- **Music theory (US6 demo)** — extensibility example, demonstrates the 3-file drop.

---

## Two modes

- **Mode A — Course-style**: multi-chapter scroll-snap lesson, Coursera-style. Default for textbooks, codebases, vocab lists.
- **Mode B — Case-study**: 3-act lecture (Evidence → 2 Lectures → Synthesis). Triggered by incident reports, postmortems, "make this a teaching moment". Delegates to the sibling skill at `~/.claude/skills/case-study.md`.

Mode is auto-detected from user intent + source type. Slash-command variants (`/chiron-case-study`) bypass detection.

---

## Persistence model

| Layer | What it stores | Where |
|---|---|---|
| **Per-lesson SQLite** | Quiz attempts, mastery, SR cards, bookmarks, LLM cache | `<lesson-output-dir>/.chiron-state.db` |
| **In-browser LocalStorage** | Scroll position, chapter-completion checkmarks | Browser-local |
| **Source copy** | Original PDF/CSV/source files (FR-030) | `<lesson-output-dir>/source/` |

Single learner per lesson — no auth, no multi-tenant infra. The "social" feel comes from AI multi-personas (peer learners + expert + native speaker) rendered into the lesson content, not from real users.

---

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| `lesson.html` opens but a chapter is blank | Stage 4 chapter abort — check stderr log | Re-run; if persistent, check validator output |
| Long run / unexpected token spend | No in-tree cost guard (Q8) — interrupt the parent Claude Code session manually if needed; trim chapter count in `curricula/<domain>.json` |
| Re-open shows no due cards | Either no cards are due yet, or `_chiron_meta.schema_version` mismatch | Check stderr for migration errors |
| Italian fill-blank rejects "caffe" but accepts "caffè" | `fuzzyMatch` not set to `'accent'` for that blank | Inspect generated WidgetSpec; re-grade prompt if recurring |
| `code-runner` widget says "Pyodide unavailable" | Offline + Pyodide CDN unreachable | Expected per R-03 — rest of lesson works |
| Gemini TTS sounds robotic | Acceptable for Phase 3; if persistent, switch to ElevenLabs per R-01 | Replace TTS provider in `lib/` |

---

# Adding a new domain (US6 extensibility)

This section is for **domain extenders** — adding a brand-new domain to Chiron without touching pipeline code.

## TL;DR

Adding a new domain to Chiron = drop **3 files**. The pipeline auto-discovers them, validates them, and routes to them based on `TriggerContext.domain`. No pipeline code changes required — that's the whole point of FR-002.

See `SKILL.md` for the top-level skill descriptor; this section documents the extensibility contract.

---

## The 3 files

For a new domain `<domain>` (e.g. `music-theory`, `chemistry`, `ml-systems`), drop these three files:

1. **`skill/concepts/<domain>.json`** — concept DAG.
   - Shape: array of `{id, label, prereqs[], description}` nodes.
   - Constraints: no cycles, every `prereqs[]` entry must reference an existing `id`, ids must be unique.
   - Validated against `lib/validator.ts` (`validateConceptDag()`).

2. **`skill/curricula/<domain>.json`** — curriculum knobs.
   - Required fields: `chapterCountTarget`, `perChapterQuizTarget`, `perChapterSrCardTarget`, `widgetMix`, `themeId`, `personasFile`.
   - Optional: `subMode` for variants like `medicine-amboss` vs `medicine-uptodate`.

3. **`skill/personas/<domain>.json`** — AI multi-personas.
   - Shape: `{expert, peers[]}` per `lib/schemas/personas.ts`.
   - `expert`: subject-matter authority (e.g. attending physician, music theorist).
   - `peers[]`: 2–3 fellow-learner personas to drive Feynman-style discourse.

---

## Optional 4th: prompt-template variants

Most domains do **not** need these. Drop them only when the default prompts are pedagogically wrong for your domain.

- **Sub-mode curriculum variants**: for domains with `subMode`, drop `skill/curricula/<domain>-<submode>.json` (e.g. `curricula/medicine-amboss.json` vs `curricula/medicine-uptodate.json`). Stage 1 of the pipeline picks the right curriculum file based on `TriggerContext.subMode`.
- **Domain-specific quiz prompts**: drop `skill/prompts/04*-quiz-<domain-specific>.md` (e.g. `04c-quiz-clinical-vignette.md` for medicine USMLE/AMBOSS-style vignettes). Stage 4 routes to the domain-specific variant when present.
- **Domain-specific ingest prompts**: drop `skill/prompts/00-ingest/<sourceType>-<domain>.md` (e.g. `pdf-medicine.md` for clinical-textbook ingest with PHI/figure-caption-extraction tweaks).

---

## Validation steps

After dropping the 3 (or 4) files, run these checks before triggering `/chiron`:

1. **JSON parse check** (every file):
   ```bash
   node -e 'JSON.parse(require("fs").readFileSync("skill/concepts/<domain>.json","utf8"))'
   node -e 'JSON.parse(require("fs").readFileSync("skill/curricula/<domain>.json","utf8"))'
   node -e 'JSON.parse(require("fs").readFileSync("skill/personas/<domain>.json","utf8"))'
   ```

2. **Concept-DAG validator**:
   - **FUTURE**: `node skill/scripts/validate-domain.js <domain>` (this script does not exist yet — flag as TODO).
   - **For now**: invoke `lib/validator.ts.validateConceptDag()` manually from a one-off Node script or via the test driver.

3. **Drop a golden input** at `skill/tests/golden-inputs/<domain>-<topic>/` containing at least one `.chiron-input.json` manifest with `"domain": "<your-domain>"`.

4. **Drop a snapshot** at `skill/tests/snapshots/<domain>-<topic>.json` listing expected fields (concept count, chapter count, persona names, etc.).

5. **Run the test suite**:
   ```bash
   bash skill/tests/test.sh
   ```
   The driver auto-discovers `golden-inputs/` and `snapshots/` pairs — your new domain is picked up automatically. Confirm it passes.

---

## Worked example: `music-theory`

The newly-dropped files (T111 / T112 / T113) demonstrate the pattern end-to-end:

- `skill/concepts/music-theory.json` — 10 concepts (intervals, scales, chord quality, voice leading, …) with prereq edges.
- `skill/curricula/music-theory.json` — 5-chapter scroll-modules curriculum with `widgetMix` favoring interactive ear-training widgets.
- `skill/personas/music-theory.json` — Sofia (expert), Theo + Maya (peers).

**These three files were dropped without modifying any pipeline code.** The next time you trigger `/chiron` with `domain: 'music-theory'`, Chiron auto-discovers them, validates the DAG, and routes Stages 1–6 through the music-theory curriculum and personas. That is the extensibility win — adding a domain is a config change, not a code change.

---

## Anti-pattern warnings

- **Don't add domain-specific logic to `pipeline.ts`**. The pipeline is domain-agnostic by design. If you find yourself reaching for an `if (domain === 'medicine')` branch, the right answer is almost always a curriculum knob or a prompt-template variant.
- **Don't fork the validator for new domains**. Concept-DAG validation is universal — cycles, missing prereqs, duplicate ids are wrong everywhere.
- **Don't bypass the 3-file convention** by hardcoding domain strings in `lib/`, `shell/`, or anywhere else outside `skill/{concepts,curricula,personas,prompts}/`. The whole contract relies on auto-discovery.
- **Don't strip pedagogical depth** to "simplify" a new domain. If a domain genuinely needs MCQ + clinical vignette + agreement-matrix (medicine), give it all three. Per CLAUDE.md, domains are co-equal.
