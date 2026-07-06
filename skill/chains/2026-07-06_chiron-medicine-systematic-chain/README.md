# chiron-medicine-systematic-chain

Single-disease, **11-section systematic deep-dive** — the fourth depth in the ladder
(`primer` < `atlas` < `systematic` < ...).

Where the **primer** chain (`2026-07-05_chiron-medicine-primer-chain`) reads the curated
`disease-atlas.json` for a whole system/subject and groups its issues into a handful of
LIGHT chapters, and the **AMBOSS** chain (`2026-06-29_chiron-medicine-lesson-chain`) lets
the LLM plan an arbitrary number of chapters for a subject, this chain takes **one disease**
and walks it through a **FIXED, hardcoded 11-section skeleton** — no atlas read, no
LLM-planned chapter count, no grouping:

1. Definition & Summary
2. Epidemiology, Etiology & Pathogenesis
3. Classification / Subtypes
4. Pathophysiology — **DEEP** (richer exposition, flow/pathway diagrams, mathjax)
5. Clinical Features / Manifestations
6. Diagnosis & Workup
7. Differential Diagnosis
8. Treatment / Management
9. Complications
10. Prognosis & Prevention
11. Clinical Reasoning & High-Yield Integration — **capstone** (cumulative vignette,
    match-madness over every prior section, closing `boss`)

Each section-chapter is authored with the **FULL AMBOSS widget palette** — `04a-chapter-write.md`
+ the `medicine-amboss.json` curriculum's `widgetMix` + the mandatory `04c` clinical vignette +
`04u-medical-algorithm-widgets.md` — grounded per-section via `harrison-search`. This is the
deep/rich variant; do not thin the widget mix down the way the primer does.

## Phases

| Phase | What |
|---|---|
| 1 | PLAN — one LLM call fills the fixed 11-section skeleton with a per-section `focus` sentence + `keyConcepts`, tailored to `CH_SUBJECT`. The skeleton itself is never LLM-decided. |
| 2 | VALIDATE — light shape check; asserts exactly `CHAPTER_COUNT_EXACT` (11) sections. |
| 3 | PER-SECTION AUTHOR (`ExternalLoop`/`over_worklist`) — Harrison-grounded, full AMBOSS widget palette, section-specific widget hints, special-cased Pathophysiology (deep) and the capstone (cumulative). Self-repair loop + render-check drop-and-log + `NEEDS_REVIEW` continue-on-failure + per-chapter resume. |
| 3.9 | Copy shell theme CSS next to the lesson. |
| 4 | ASSEMBLE — `assemble-medicine.mjs`, typed `chapterN.json` → `lesson.html`. No model ever codes HTML. |
| 5.5 | Lecture scripts (`04s-lecture-script.md`) → `audio-scripts.json`. |
| 6 | Bake via Atelier OmniVoice (Mac, `pauls-tutor` persona, −20 LUFS). |
| 7 | Stamp `chiron.json` (`generator: chiron-systematic`, `depth: systematic`, `scope: disease`) + rebuild the library index. |

## Env

- `OLLAMA_API_KEY` — required (source `~/.config/environment.d/ollama-cloud.conf`).
- `CH_SUBJECT` — the single disease (default `"Aortic aneurysm"`).
- `CH_SYSTEM` — tag-only label for `chiron.json.tags.sys` (default `"General"`).
- `CH_STAGE` — `plan | chapters | assemble | audio | all` (default `plan`).
- `CH_FORCE=1` — replan / re-author instead of resuming from existing `syllabus.json` / `chapterN.json`.
- `CH_MODEL_REASON`, `CH_MODEL_STRUCT`, `CH_CHAPTER_ENGINE` (`glm` | `claude`) — same knobs as the sibling chains.

## Run

```bash
cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-07-06_chiron-medicine-systematic-chain
```

Output lands in `~/Documents/generated/chiron-<subject>-systematic/`.
