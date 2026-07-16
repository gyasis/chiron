# chiron MEDICINE (AMBOSS) lesson chain — run.py

Chain 1 of 4 from the chiron off-site lesson-gen investigation (verdict (C) Hybrid).
Adapts the Pharos dataviz generator (recipe `dataviz-generator-pipeline`) to chiron medicine lessons.

## What it does (phases)
ingest/source-pack → **library-dedup (no LLM)** → brief+syllabus → validate → per-chapter
(grounded via `harrison-search` + AVOID-vignettes) → assemble. Models: Ollama Cloud
(deepseek-v3.2 reasoning / qwen3-coder:480b structured), `max_tokens` automatic.

The **dedup** phase scans already-generated medicine `chapter*.json` for covered concepts +
existing clinical-vignette MCQs and injects an AVOID list so we don't repeat cases/questions.

## Run
```bash
source ~/.config/environment.d/ollama-cloud.conf      # OLLAMA_API_KEY
cd ~/Documents/PromptChain
# plan only (cheap — brief + syllabus, no chapters):
CH_SUBJECT="Cardiac Arrhythmias" CH_SYSTEM=Cardiovascular CH_CHAPTERS=4 CH_STAGE=plan \
  bash scripts/observe.sh runs/2026-06-29_chiron-medicine-lesson-chain
# full: CH_STAGE=all  (authors chapterN.json, then assemble if assemble-medicine.mjs exists)
```
Output → `~/Documents/generated/chiron-<subject>-amboss/` (`brief.json`, `syllabus.json`, `chapterN.json`, `source/`).

## Status / next
- v1 grounding is a **deterministic** harrison-search fn (pre-injected) — robust vs tool-call-weak models.
- Phase-2 is a light shape check; the ≤3 retry loop is the next increment.
- Phase-4 assemble needs the generic `skill/scripts/assemble-medicine.mjs` (Task #7 — generalize
  `build-bloodchem-assemble.mjs`); until then chapterN.json are emitted and assemble is skipped.
- Sibling chains (wards / medical-Italian / pure-Italian) reuse this spine; swap prompts + grounding + persona.
