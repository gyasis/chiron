# Active Context

**Last Updated**: 2026-04-30 09:30:08

## Current Focus
chiron: complete wave 12 (119/129); Q8 invariant verified, US6 regression check shipped

Wave 12 (T079, T109, T114, T117, T120, T122-T125, T128):
- assertion-reason renderer (5-option USMLE format A/B/C/D/E with data-relationship keys)
- mid-conversation mode override handler in trigger-context.ts (later-occurrence wins)
- US6 extensibility regression check: git-status baseline before/after, FAIL on any
  change to skill/lib, ingest-adapters, shell during a new-domain run; music-theory
  cadences 1-paragraph fixture + snapshot
- Chapter-completion tracking in main.js (90% scroll + 50% quiz threshold; localStorage;
  TOC checkmarks; chiron:widget-checked custom event listener for forward-compat)
- apkg-export v1 stub (counts by card_type, writes .pending.json sidecar, documents
  card-type→Anki-model mapping; real ZIP/SQLite builder TBD)
- Image-count up-front announcement in pipeline.ts (FR-028 / R-10) — emits before
  first interpret_image MCP call
- skill/README.md rewritten: user-facing quickstart leads; US6 extensibility demoted
- repo-root README.md: status badges, foundational facts, doc hierarchy, architecture
  summary, heritage repos, open PRDs
- repo-root CLAUDE.md: skill location + symlink instruction
- Q8 invariant verified: zero @anthropic-ai/sdk / @google/generative-ai imports under
  skill/ (only benign match is filename-pattern string in agent-report.ts)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |   9 +
 .claude/session_snapshots/snapshot_latest.json   |   2 +-
 .claude/system_bus.json                          |   5 +
 memory-bank/private/gyasisutton/activeContext.md |  78 +++----
 memory-bank/private/gyasisutton/progress.md      |  18 +-
 skill/lib/trigger-context.ts                     |  67 +++++-
 skill/lib/widget-renderer.ts                     | 268 +++++++++++++++++++++++
 skill/shell/main.js                              | 222 +++++++++++++++++++
 specs/001-chiron-v1/tasks.md                     |  10 +-
 9 files changed, 604 insertions(+), 75 deletions(-)
```

## Modified Files
.claude/activity_stream.md
.claude/session_snapshots/snapshot_latest.json
.claude/system_bus.json
memory-bank/private/gyasisutton/activeContext.md
memory-bank/private/gyasisutton/progress.md
skill/lib/trigger-context.ts
skill/lib/widget-renderer.ts
skill/shell/main.js
specs/001-chiron-v1/tasks.md

## Next Actions
- Continue implementation
- Run tests
- Create checkpoint
