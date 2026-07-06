# chiron-medicine-atlas-chain

**Depth ladder position:** primer < **ATLAS** < systematic.

An organ-system SURVEY generator. Reads the curated `skill/blueprints/disease-atlas.json`
for a subject (an organ system, e.g. `Cardiovascular`), bounds to the top ~N high-yield
diseases (`CH_MAX_DISEASES`, default 12 — enough for a real survey without ballooning the
chapter count), and emits **one chapter per disease** — a deterministic entity-axis mapping
(no LLM planning step: `brief.clinicalAtlasUnits` = the disease list, `chapterCountExact` =
`len(diseases)`; see `skill/prompts/04a-chapter-write.md` "Brief inputs that drive medicine
layout").

## What makes this the ATLAS depth (not the primer)

The **2026-07-05 primer chain** (`../2026-07-05_chiron-medicine-primer-chain`) *groups*
several curated issues into a handful of light chapters (concise prose, 1-2 widgets). The
**ATLAS** chain does the opposite: it keeps the disease-per-chapter granularity of the
2026-06-29 AMBOSS chain, but drives its disease list from the curated atlas instead of an
LLM-planned syllabus. Every chapter is authored as a **FULL canonical AMBOSS disease
article** — the complete `04a-chapter-write.md` widget palette (why-care-callout,
pattern-cards, flow-animation for DDx/workup algorithms, step-cards for protocols,
agreement-matrix, assertion-reason, glossary-tooltips), ONE mandatory
`mcq-clinical-vignette`, widgets varied per the `medicine-amboss.json` curriculum's
`widgetMix`, and `srCards` — covering overview -> epidemiology -> etiology ->
pathophysiology -> clinical-features -> diagnostics -> differential -> treatment ->
complications -> prognosis inside the chapter. This is deliberate: the primer chain's
stripped-down widget set was a known mistake to avoid repeating here — an atlas chapter
must read as a real disease-article survey, not a light overview.

## Pipeline

| Phase | What | LLM? |
|---|---|---|
| 0.5 | Read `disease-atlas.json` for `CH_SUBJECT`, filter `highYield===true`, drop cross-list pointer rows (`"... (see OtherSystem)"`), bound to `CH_MAX_DISEASES` | no |
| 1 | Build the syllabus — one chapter per selected disease (deterministic) | no |
| 2 | Validate (shape/titles) | no |
| 3 | Author each chapter: Harrison-grounded, full AMBOSS widget palette, mandatory vignette, render-check gate (drop unrenderable widgets, never abort the lesson) | yes |
| 3.9 | Copy theme CSS next to the lesson | no |
| 4 | Assemble `chapterN.json` + `syllabus.json` -> `lesson.html` (`assemble-medicine.mjs`) | no |
| 5.5 | Lecture scripts per section (`04s-lecture-script.md`, medical-TTS safety rule) | yes |
| 6 | Bake audio via Atelier OmniVoice on the Mac (`pauls-tutor`, −20 LUFS) | no (remote TTS) |
| 7 | Stamp `chiron.json` (`generator: chiron-atlas`, `depth: atlas`, `status: staged`) + rebuild the library index | no |

## Run

```bash
source ~/.config/environment.d/ollama-cloud.conf   # OLLAMA_API_KEY

cd ~/Documents/PromptChain
CH_SUBJECT="Cardiovascular" CH_MAX_DISEASES=12 CH_STAGE=plan \
  bash scripts/observe.sh runs/2026-07-06_chiron-medicine-atlas-chain

# then, once the plan looks right:
CH_SUBJECT="Cardiovascular" CH_STAGE=all \
  bash scripts/observe.sh runs/2026-07-06_chiron-medicine-atlas-chain
```

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `CH_SUBJECT` | `Cardiovascular` | organ-system name (or one of its `aliases`) in `disease-atlas.json` |
| `CH_MAX_DISEASES` | `12` | bound on high-yield diseases selected -> chapter count |
| `CH_STAGE` | `plan` | `plan` \| `chapters` \| `assemble` \| `audio` \| `all` |
| `CH_MODEL_REASON` / `CH_MODEL_STRUCT` | `glm-5.2` | Ollama Cloud models for lecture-scripts / chapter authoring |
| `CH_CHAPTER_ENGINE` | `glm` | `glm` (Ollama) or `claude` (headless `claude -p`) for the chapter-authoring seam |
| `CH_FORCE` | unset | `1` forces a rebuild of an existing syllabus/chapter instead of resuming |
| `CH_AUDIO_QC` | unset | `1` enables per-clip Gemini audio QC in the bake step (costs tokens) |

Output lands in `~/Documents/generated/chiron-<subject-slug>-atlas/`.
