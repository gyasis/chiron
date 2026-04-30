# Active Context

**Last Updated**: 2026-04-30 09:07:11

## Current Focus
chiron: complete wave 11 (109/129); Mode-B delegation + US6 extensibility shipped

Wave 11 (T078,T106-T108,T110-T113,T115,T116):
- agreement-matrix renderer (table with radios, rationale, lock-after-check)
- research-paper-jones2025 snapshot + test.sh validators (forest-plot extraction
  with HR ±0.02 / I² ±2 floating tolerances, section-structure containment,
  Dr. Hofmann dialogue presence)
- Mode-B case-study delegation in pipeline.ts (decideMode, delegateToCaseStudy,
  CaseStudyHandoff). stage1Brief return type now 3-way union including
  CaseStudyHandoff; preflight refusal still wins
- case-study-incident golden input (1323-word synthetic payment-gateway
  postmortem) with expected-handoff.json
- US6 extensibility demonstration: music-theory domain dropped as 3 files
  (10-concept DAG, 5-chapter curriculum, Sofia+Theo+Maya personas) without
  modifying any pipeline code
- skill/README.md documents the per-domain drop process with worked example
- shell/main.js: localStorage-based scroll-position restore (Option A —
  decoupled from SQLite; 500ms debounce; lesson-id from <meta> tag)

Open issues for Wave 12+:
- <meta name="chiron-lesson-id"> injection needs verification in build.sh
- data-chapter-id attribute convention needs alignment with assemble.ts
- skill/scripts/validate-domain.js TODO (referenced in README)
- Forest-plot vendor renderer must emit data-pooled-hr / data-i2 / data-section
  attributes for T107 test validators to pass
- AssertionReason 5-option mapping — harness/balancer may need 5-letter update
- stage1Brief callers (none yet) need union-aware return-type handling

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |  13 ++
 .claude/session_snapshots/snapshot_latest.json   |   2 +-
 .claude/system_bus.json                          |   5 +
 CLAUDE.md                                        |  18 +++
 README.md                                        |  88 ++++++++------
 memory-bank/private/gyasisutton/activeContext.md |  62 +++++++---
 memory-bank/private/gyasisutton/progress.md      |  28 ++---
 skill/README.md                                  | 134 ++++++++++++++++++++-
 skill/lib/pipeline.ts                            | 106 +++++++++++++++++
 skill/lib/trigger-context.ts                     |  72 +++++++++++
 skill/lib/widget-renderer.ts                     | 139 ++++++++++++++++++++++
 skill/shell/main.js                              | 145 +++++++++++++++++++++++
 skill/tests/test.sh                              |  85 +++++++++++++
 specs/001-chiron-v1/tasks.md                     |  20 ++--
 14 files changed, 838 insertions(+), 79 deletions(-)
```

## Modified Files
.claude/activity_stream.md
.claude/session_snapshots/snapshot_latest.json
.claude/system_bus.json
CLAUDE.md
README.md
memory-bank/private/gyasisutton/activeContext.md
memory-bank/private/gyasisutton/progress.md
skill/README.md
skill/lib/pipeline.ts
skill/lib/trigger-context.ts
skill/lib/widget-renderer.ts
skill/shell/main.js
skill/tests/test.sh
specs/001-chiron-v1/tasks.md

## Next Actions
- Continue implementation
- Run tests
- Create checkpoint
