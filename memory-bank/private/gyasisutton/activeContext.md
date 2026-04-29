# Active Context

**Last Updated**: 2026-04-29 15:57:59

## Current Focus
chiron: complete waves 2-6 (60/129 tasks); table TTS as separate PRD

Waves 2-6 closed across this session:
- Wave 2: Phase 2 foundational (T011-T023, partial) — sqlite, schemas, validators,
  theme registry, widget primitives, pipeline progress/source-copy
- Wave 3: pipeline orchestrator + entry-point (T017,T018,T024,T025,T027-T032) —
  brief schema, validator with DAG cycle detection, 5-stage pipeline w/ Q8
  prompt-handoff pattern, SKILL.md, mode heuristic, 5 stage prompts
- Wave 4: code-domain US1 start (T021,T026,T033-T035,T037-T039,T041,T042) —
  chemistry-renderer, trigger-context, assemble.ts, code DAG/curriculum, code-repo
  ingest adapter, spot-the-bug + code-runner widgets, ChalkAI loader, MCQ prompt
- Wave 5: code-domain US1 finish + IT US2 start (T036,T040,T043-T050) — code
  personas, fill-blank widget, peer/expert/sr-card/spot-the-bug prompts,
  result-util golden-input fixture (171 LOC, strict-compiles), test driver +
  snapshot, italian concept DAG
- Wave 6: italian US2 (T051-T055,T059-T063) — vocab/grammar curricula, italian
  personas, vocab-list adapter, fill-blank renderer w/ FR-020 accent normalize,
  TTS handoff stub, ingest/quiz prompts, passato-prossimo golden-input

Issue-fixer pass corrected three contract divergences:
- SpotTheBugWidget field name (`code` -> `codeBlock`, schema canonical)
- sr_cards.tags column added to sqlite-schema.sql
- personaDialogue ownership: Stage 4l (peer-dialogue) is canonical;
  04a-chapter-write no longer emits the field

Tabled to separate PRD (`~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md`):
- TTS provider selection — Wave 6 surfaced that Gemini MCP server lacks a
  `tts_synthesize` tool. Decision deferred; 8-provider matrix captured;
  ear-test rig proposed; T059 ships as placeholder until PRD resolves.

Pattern shift mid-session: Waves 2-3 were authored in-context by the main
agent; Waves 4-6 used 10 parallel general-purpose subagents per wave with
explicit file-ownership scoping and per-task tasks.md handshake. Each wave
also dispatched 1 issue-fixer subagent to converge schema vs prompt drift.

Open issues for follow-up waves:
- Gemini MCP no listed TTS tool (tracked in TTS PRD)
- source-copy.ts only async; vocab-list adapter inlined sync fs (sync wrapper TBD)
- Some tasks.md descriptions reference field names that diverged from the
  canonical Zod schemas; subagents wrote to schema, task descriptions stale

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |  9 ++++
 .claude/session_snapshots/snapshot_latest.json   |  2 +-
 .claude/system_bus.json                          |  5 +++
 memory-bank/private/gyasisutton/activeContext.md | 57 ++++++++++++++++++------
 memory-bank/private/gyasisutton/progress.md      |  2 +-
 5 files changed, 60 insertions(+), 15 deletions(-)
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
