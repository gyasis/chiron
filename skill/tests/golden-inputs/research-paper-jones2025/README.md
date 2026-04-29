# research-paper-jones2025 — synthetic research paper fixture

This is a SYNTHETIC research paper fixture. **"Jones et al. (2025)" does not exist** —
the paper, authors, journal, and trial-level data are fabricated for testing purposes
only and must not be cited as real evidence.

Topic: meta-analysis of GLP-1 receptor agonists (RA) on cardiovascular mortality
in type 2 diabetes mellitus (T2DM), with a 12-trial forest plot.

Used by the research-paper-domain pipeline to exercise:
- Forest-plot extraction (T104) — `forest-plot-table.md` provides 12 study rows.
- Slider-estimation lesson generation (T103) — pooled HR + per-study HR drive sliders.
- Methodology critique paths — PRISMA, RoB 2.0, heterogeneity (I², τ²) language.

All numbers are internally consistent across `paper.md` and `forest-plot-table.md`.
Marked as a teaching fixture; do not promote into any production knowledge base.
