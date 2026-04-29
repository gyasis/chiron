# medicine-pneumonia (golden input fixture)

Teaching fixture for the medicine-domain pipeline of Chiron. Topic: community-acquired
pneumonia (CAP), aligned to IDSA/ATS 2019 guideline level. NOT for clinical use.

## What this fixture exercises

- **Text-extract path** — `chapter.md` is markdown prose simulating a textbook
  chapter; the bundle adapter routes it through the markdown/PDF text extractor.
- **Vision path** — `figure-cxr.png` is a placeholder PNG (1x1) the adapter
  detects as an image asset and routes through the vision/multimodal extractor.
  Companion `figure-cxr.txt` describes the intended content for snapshot tests.

## Expected lesson outputs (medicine sub-mode = `amboss`)

- USMLE/AMBOSS-style **clinical vignettes** (stem + labs + leading question + 5 options + per-distractor explanations)
- **Agreement-matrix** items (always/sometimes/never clinical reasoning)
- **Attending-physician tips** (the subject-expert persona)
- SR cards: disease, drug, mechanism

## Difficulty calibration

CEFR-equivalent expectation: **intermediate clinical** (M3 medical student / PA-C / NP intern).
