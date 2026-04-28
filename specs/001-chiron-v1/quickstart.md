# Quickstart — Chiron v1

**Audience**: future-Gyasi resuming work, or any AI agent doing the buildout.
**Prerequisite**: `/speckit-tasks` has run and tasks.md is being executed; or v1 has shipped and you're using it.

## During buildout (Phase 1 → ship)

```bash
cd ~/dev/projects/chiron
git checkout 001-chiron-v1                 # this branch
cat specs/001-chiron-v1/plan.md            # the plan
cat specs/001-chiron-v1/research.md        # Phase 0 unknowns + decisions
cat specs/001-chiron-v1/data-model.md      # entities + DB
ls  specs/001-chiron-v1/contracts/         # interface contracts
# Once tasks.md exists:
cat specs/001-chiron-v1/tasks.md           # ordered task list
```

The PRD ([`prd/chiron_design_v1_2026-04-28.md`](../../prd/chiron_design_v1_2026-04-28.md)) remains the design source of truth. If anything in this `specs/001-chiron-v1/` tree disagrees with the PRD, the PRD wins.

## Once v1 is shipped — using Chiron

### Setup (one-time)

```bash
# Skill location — symlink the in-repo skill into Claude Code's skill dir
ln -s ~/dev/projects/chiron/skill ~/.claude/skills/chiron
```

**No API keys to set for Chiron itself** (Q8 — skill-driven, no direct SDK). The skill uses:
- The parent Claude Code session for all text-LLM work (whatever model you're running on)
- The Gemini MCP server you've already configured (`mcp__gemini-mcp__*`) for `interpret_image`, optional `gemini_research`, opt-in `start_deep_research`, and Italian TTS

If `mcp__gemini-mcp__*` isn't configured in your `~/.claude.json`, image-source ingest (scanned PDFs, image folders) and Italian TTS will fail with a clear error pointing at the MCP setup.

### Generate a lesson — natural-language style

In any Claude Code session:

```text
teach me hooks in this React repo at ~/code/my-react-app
make a course on community-acquired pneumonia from ~/Downloads/cap-amboss.pdf
make a lesson out of these Italian vocab words from ~/lang/italian-a1.csv
case-study this incident-report.md
```

### Generate a lesson — slash-command style

```text
/chiron ~/code/my-react-app
/chiron-medicine ~/Downloads/cap-amboss.pdf
/chiron-language ~/lang/italian-a1.csv
/chiron-research-paper ~/papers/jones2025.pdf
/chiron-case-study ~/notes/incident-report.md
```

Both styles produce the same output. The slash-command form pre-fills the domain/mode and bypasses the heuristic.

### What gets produced

```text
<lesson-output-dir>/
├── lesson.html               # single self-contained HTML — open this
├── .chiron-state.db          # SQLite — quiz attempts, mastery, SR cards, bookmarks
├── source/                   # original PDF/CSV/transcript copied in (FR-030)
├── audio/                    # Italian TTS clips (language only)
└── brief.json                # Stage 1 Brief sidecar (debugging)
```

### Re-opening a lesson

Just open `lesson.html` again. The page reads `.chiron-state.db`, restores scroll position, marks completed chapters, and surfaces due SR cards inline at the top of the page (FR-011, FR-013, SC-006).

### Cost visibility (Q8 — no in-tree cost guard)

Chiron does not track or cap LLM costs in-tree. You see whatever Claude Code's parent session reports natively. For image-heavy ingests, Stage 0 announces the image count up front (e.g. `[stage 0/5] ingest: scanned-PDF (32 pages — 32 interpret_image calls follow)`) so you can interrupt before a heavy run.

### Deep-research opt-in

By default, Chiron does NOT call `mcp__gemini-mcp__start_deep_research` (FR-029). If during generation you want to expand on a secondary topic, say:

```text
expand on the renin-angiotensin pathway with deep research
```

…and Chiron will make exactly **one** `start_deep_research` MCP call → poll via `check_research_status` → retrieve via `get_research_results` → save via `save_research_to_markdown` into `<lesson-output-dir>/research/`. Hard cap: one per lesson.

### Adding a new domain post-v1

1. Author `concepts/<domain>.json` (DAG with prereqs).
2. Author `curricula/<domain>.json` (chapter scaffold + per-chapter targets).
3. Author `personas/<domain>.json` (expert + peers + optional native-speaker).
4. (Optional) Add a prompt-template variant under `prompts/` if the domain has unusual content shape.

That's the entire delta. No TS source under `lib/`, `ingest-adapters/`, or `shell/` is modified (FR-025, SC-007).

## Eval rig — verifying ship-readiness

```bash
cd skill/tests
./test.sh                                  # runs all 4 golden inputs + diffs snapshots
```

A passing run means: every golden input generates without error, all snapshot key fields match, and `lesson.html` opens in a headless browser without console errors.

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| `lesson.html` opens but a chapter is blank | Stage 4 chapter abort — check stderr log | Re-run; if persistent, check validator output |
| Long run / unexpected token spend | No in-tree cost guard (Q8) — interrupt the parent Claude Code session manually if needed; trim chapter count in `curricula/<domain>.json` |
| Re-open shows no due cards | Either no cards are due yet, or `_chiron_meta.schema_version` mismatch | Check stderr for migration errors |
| Italian fill-blank rejects "caffe" but accepts "caffè" | `fuzzyMatch` not set to `'accent'` for that blank | Inspect generated WidgetSpec; re-grade prompt if recurring |
| `code-runner` widget says "Pyodide unavailable" | Offline + Pyodide CDN unreachable | Expected per R-03 — rest of lesson works |
| Gemini TTS sounds robotic | Acceptable for Phase 3; if persistent, switch to ElevenLabs per R-01 | Replace TTS provider in `lib/` |
