# Active Context

**Last Updated**: 2026-04-29 21:51:27

## Current Focus
chiron: complete waves 9-10 (99/129); medicine US3 + research-paper US4 scaffolded; T058 tabled

Wave 9 (T058,T086-T094): audio-tts widget renderer (provisionally authored,
later reverted), all 4 ingest prompts (pdf/image/agent-report/bundle), 4
medicine quiz prompts (clinical-vignette w/ AMBOSS taxonomy + hammer +
attending-tip + 5-option USMLE layout, agreement-matrix, assertion-reason
classic 4-option, chemical-rendering w/ mhchem+SMILES), Stage-0 medicine
source refusal (FR-016/FR-035/SC-016) wired into pipeline as preflight check.

Wave 10 (T077,T095-T100,T103-T105): mcq-clinical-vignette renderer (keyInfo
chips, 5-option, hammer rating, attending tip), medicine-pneumonia golden
input (220-line CAP chapter w/ IDSA/ATS-aligned doses + 1px PNG vision-path
fixture), pneumonia snapshot, test.sh medicine domain validators
(vignetteCount/taxonomy/hammer/keyInfo/attendingTip/chem/molecule/verifier),
research-paper concept DAG (28 concepts: IMRAD/designs/biostat/appraisal),
research-paper curriculum (fixed 6-chapter), Dr. Hofmann/Bob/Mike personas,
slider-estimation prompt, forest-plot extraction prompt (skip-not-fabricate
when paper is not a meta-analysis), synthetic Jones 2025 GLP-1 meta-analysis
golden input (252 lines, internally consistent across files: HR 0.86 / I²=18%).

User-directed corrections during waves 9-10:
- T058 audio-tts widget renderer REVERTED to TTS PRD scope. Provisional code
  remains in widget-renderer.ts (harmless without audio files); task stays
  unchecked in tasks.md until provider selection lands. PRD §8 absorbed all
  audio-related downstream blockers (file format, streaming, caching, snapshot
  count keys).
- T092 assertion-reason switched from 4-option (A/B/C/D) to 5-option USMLE
  format (A/B/C/D/E) per user direction. Schema's correctRelationship enum
  already had all 5 values; prompt now matches with USMLE distractor pattern
  encoded (1 correct + 1 close-but-wrong + 2 standard distractors + 1
  obviously-wrong). Distribution targets re-weighted (25/30/20/15/10).

Open issues for follow-up waves:
- T097 medicine validators reference HTML markers that the renderers must
  actually emit (data-hammer, key-info-chips, attending-tip, etc.) — T077 now
  emits these but cross-link verification deferred to first end-to-end run
- AssertionReasonWidget correct-option index mapping still uses 4-letter
  schema label hint; harness/balancer may need a 5-letter mapping update
- bundle.ts vocab-list call uses legacy 3-arg shape (predates universal opts)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## Recent Changes
```
 .claude/activity_stream.md                       |  9 ++++
 .claude/session_snapshots/snapshot_latest.json   |  2 +-
 .claude/system_bus.json                          |  5 ++
 memory-bank/private/gyasisutton/activeContext.md | 64 ++++++++++++++++--------
 memory-bank/private/gyasisutton/progress.md      |  2 +-
 5 files changed, 59 insertions(+), 23 deletions(-)
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
