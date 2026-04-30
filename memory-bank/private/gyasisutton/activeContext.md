# Active Context

**Last Updated**: 2026-04-30 20:01:00

## Current Focus
chiron: add SETUP.md for fresh-clone bootstrap; tighten .gitignore

Audit for portability across Claude Code sessions surfaced:
- No hardcoded /home/gyasisutton paths in skill/ ✓
- No @anthropic-ai/sdk imports (Q8 invariant holds) ✓
- skill/scripts/install.sh is portable (BASH_SOURCE-resolved) ✓
- package.json declares all runtime + dev deps ✓

Issues fixed:
- Added SETUP.md at repo root: fresh-clone quickstart, prerequisites table,
  step-by-step bootstrap (clone → install.sh → npm install → npm run build →
  test.sh), what-lives-where map, what's-NOT-in-repo table, fresh-Claude-Code
  -session operating instructions, US6 extensibility cheat-sheet, open caveats
- README.md: added SETUP.md pointer near TL;DR
- .gitignore: now excludes per-machine .claude/ dev-kid state (AGENT_STATE,
  activity_stream, session_snapshots, process_registry, schema_snapshots,
  settings.local.json) so they don't conflict across contributors
- Untrack deep_research.db (was committed; it's a SQLite scratch file, not
  source). Added *.chiron-state.db patterns for runtime state.

Heritage repo references (~/dev/audits/codebase-to-course/, classbuild/,
ai-course-generator/) are documented in README/CLAUDE as historical context;
they are NOT runtime dependencies — relevant code was forked into skill/shell/
and skill/lib/ already. SETUP.md "what's NOT in repo" table makes this explicit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |  12 ++
 .claude/session_snapshots/snapshot_latest.json   |   2 +-
 .claude/system_bus.json                          |  10 ++
 memory-bank/private/gyasisutton/activeContext.md | 137 +++++------------------
 memory-bank/private/gyasisutton/progress.md      |   2 +-
 5 files changed, 52 insertions(+), 111 deletions(-)
```

## Modified Files
.claude/activity_stream.md
.claude/session_snapshots/snapshot_latest.json
.claude/system_bus.json
memory-bank/private/gyasisutton/activeContext.md
memory-bank/private/gyasisutton/progress.md

## Next Actions
- Continue implementation
- Run tests
- Create checkpoint
