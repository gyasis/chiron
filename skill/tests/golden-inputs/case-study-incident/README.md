# Golden fixture: case-study-incident (Mode B)

This is a Mode-B fixture: an incident postmortem (~1500 words) intentionally
sized below the 2000-word Mode-B threshold (FR-003) to trigger case-study
mode rather than course-style (Mode A).

The chiron lesson pipeline does NOT execute against this input. Instead,
chiron infers Mode B from the source shape (incident report, single
narrative, <2000 words) and delegates to the sibling skill at
`~/.claude/skills/case-study.md`, which owns 3-act lecture rendering.

The golden snapshot for this fixture verifies only two things:
1. Mode B is correctly inferred (not Mode A).
2. A case-study delegation handoff payload is produced (see
   `expected-handoff.json`) with the correct sibling-skill path and
   metadata.

Real lesson HTML output is the case-study sibling's responsibility and
is NOT diffed here. See `incident.md` for the source and
`.chiron-input.json` for the manifest.
