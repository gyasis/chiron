# Active Context

**Last Updated**: 2026-05-01 10:11:32

## Current Focus
install.sh: one-shot bootstrap (symlink + npm install + build + test)

Previously install.sh only created the skill symlink. Per user request, now
handles the full bootstrap so a fresh clone is one command:

  bash skill/scripts/install.sh

What it now does (in order, with logging):
1. Verifies Node ≥ 20 + npm (errors clearly if missing/too-old)
2. Symlinks (or updates symlink for) ~/.claude/skills/chiron → <clone>/skill
3. Runs 'npm install' (or 'npm ci' if package-lock.json present)
4. Runs 'npm run build' (TypeScript → dist/) with verification
5. Runs tests/test.sh to confirm the harness is wired

All steps are idempotent. Includes a final summary banner with all 6
trigger commands so the user knows what to type next.

SETUP.md: updated quickstart to reflect the one-shot script. Added explicit
note that Chiron is Node/TypeScript (no uv venv / pip / requirements.txt).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       | 12 +++++++++
 .claude/session_snapshots/snapshot_latest.json   |  2 +-
 .claude/system_bus.json                          | 10 +++++++
 memory-bank/private/gyasisutton/activeContext.md | 33 ++++++++++++++++++------
 4 files changed, 48 insertions(+), 9 deletions(-)
```

## Modified Files
.claude/activity_stream.md
.claude/session_snapshots/snapshot_latest.json
.claude/system_bus.json
memory-bank/private/gyasisutton/activeContext.md

## Next Actions
- Continue implementation
- Run tests
- Create checkpoint
