# Active Context

**Last Updated**: 2026-04-29 17:10:28

## Current Focus
chiron: complete waves 7-8 (80/129 tasks); RDKit-JS selected; verifier loop wired

Wave 7 (T056,T064-T072): matching-pair widget, italian snapshot+test driver
extension w/ FR-020 fuzzy-accent validator, medicine concept DAG (30 concepts),
AMBOSS+UpToDate curricula, Dr. Reyes/Mike/Priya personas, pdf/image/multi-pdf
ingest adapters with Q8 vision-handoff sidecar pattern.

Wave 8 (T057,T073-T076,T080,T082-T085): cloze widget (Anki-compat), url/
transcript/agent-report/bundle ingest adapters, RDKit-JS chosen over Kekule.js
for molecule rendering (smaller bundle, simpler API), QUEST-AI 3-stage verifier
prompts (Generate→Verify→Refine), verifier loop wired into pipeline.ts as
medicine-only state machine with SC-011 abort report.

Issue-fixer subagents corrected:
- Persona file shape canonized (`expert`+`peers` keys) via new Zod
  PersonaFileSchema in lib/schemas/personas.ts
- pdf/image/multi-pdf ingest adapters now require domain param (placeholder
  `'code'` removed); domain flows from trigger-context layer

TTS PRD updated to absorb downstream blockers:
- T058 audio-tts widget renderer (BLOCKED on provider selection)
- mariaAudioClipCount vs mariaAudioClipCountMin snapshot key disagreement
- audio file format (MP3 vs WAV vs OGG)
- streaming vs eager generation
- per-clip content-hash caching

Open issues for follow-up waves:
- skill/shell/vendor/molecule-renderer/install.sh not written (Stage 5 will need)
- RDKit-JS .wasm needs base64 inline shim for FR-037 single-file build
- bundle.ts calls vocab-list adapter with legacy 3-arg shape (predates universal opts)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |  9 ++++
 .claude/session_snapshots/snapshot_latest.json   |  2 +-
 .claude/system_bus.json                          |  5 ++
 memory-bank/private/gyasisutton/activeContext.md | 67 ++++++++++++------------
 memory-bank/private/gyasisutton/progress.md      |  2 +-
 5 files changed, 50 insertions(+), 35 deletions(-)
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
