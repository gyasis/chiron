# music-theory-cadences

US6 extensibility regression input. Verifies Chiron handles a new domain via 3-file drop alone.

The music-theory domain (concepts, curricula, personas) was authored at T111-T113
without touching any pipeline code. SC-007 requires that extending Chiron to a new
domain produces zero changes under `skill/lib/`, `skill/ingest-adapters/`, or
`skill/shell/`.

This fixture pairs with `tests/snapshots/music-theory-cadences.json` and triggers
the `regressionCheckType: "us6-extensibility"` branch in `tests/test.sh`, which
captures `git status --porcelain` of the three pipeline directories before and
after running discovery + validation. Any new or modified file in those dirs
fails the test.
