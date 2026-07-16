# chiron MEDICAL-ITALIAN (passage / SSM) lesson chain — run.py

A **focused, separate** PromptChain: turns one **SSM exam MCQ** into a chiron
**medical-Italian** lesson in the `language-it` **`passage`** sub-mode (the
`chiron-ssm-fattore-v` shape) — Lucrezia-voiced, bilingual, with the dual-speed
passage readings.

**NOT** the medicine chain (that stays untouched), **NOT** a unified router, **NOT**
the ward shape. One domain: medical-language, one sub-mode: passage.

## Architecture (template = the medicine chain `2026-06-29_chiron-medicine-lesson-chain`)
```
Phase 0  INGEST   — load an SSM MCQ (by SSM_QID or random) → the PASSAGE (stem + 5 options, IT). The passage IS the syllabus.
Phase 1  PLAN     — chunk the passage into coherent units (source-driven; no invented chapters).
Phase 2  AUTHOR   — 04t-language-passage-breakdown prompt → annotated-passage JSON per chunk (grammar layers + medicine `concept` layer). Self-repair loop.
Phase 3  ASSEMBLE — renderWidget (chiron generic renderer) + language-lesson-skeleton → lesson.html.
Phase 4  AUDIO    — 04s bilingual lecture (podcast self-containment) + curriculum.passageReadings → audio-scripts.json (summary, shortened, passage-fast, passage-slow).
Phase 5  BAKE     — bake-lesson-audio.mjs --domain language-it --persona lucrezia (dual-speed atempo) + QC. (off by default; CH_STAGE=all or --bake)
```

## Reuses from the chiron skill (does NOT reinvent)
- `curricula/language-it-passage.json` (the saved shape), `prompts/04t-language-passage-breakdown.md`,
  `prompts/04s-lecture-script.md` (bilingual + podcast rule), `dist/lib/widget-renderer.js` (renderWidget),
  `shell/language-lesson-skeleton.html`, `scripts/bake-lesson-audio.mjs`, `scripts/build-ssm-fattore-v.mjs` (reference).

## Run
```bash
source ~/.config/environment.d/ollama-cloud.conf            # OLLAMA_API_KEY
cd ~/Documents/PromptChain
# Step-1 (ingest+route only):
CH_STAGE=ingest SSM_QID=ssm2018_111 bash scripts/observe.sh runs/2026-06-30_chiron-medical-italian-passage-chain
# later: CH_STAGE=plan | author | assemble | audio | all ; SSM_QID omitted → random pick
```
Output → `~/Documents/generated/chiron-ssm-<qid>/` (lesson.html, audio-scripts.json, source/).

## Status
- **Step 1 (this commit):** config + helpers (reused from medicine chain) + Phase 0 ingest (SSM MCQ → passage source). Runnable for `CH_STAGE=ingest`.
- Next: Phase 1 chunk → Phase 2 04t author → Phase 3 assemble → Phase 4/5 audio+bake.
