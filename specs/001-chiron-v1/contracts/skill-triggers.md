# Skill Trigger Contract

**Source**: FR-001 + Clarification Q2 (both natural-language phrases AND slash-commands as parallel entry points)

This is the contract `chiron/skill/SKILL.md` MUST declare. It defines how a learner enters Chiron from any Claude Code session.

## Two parallel entry-point styles

### Style A — Natural-language trigger phrases

Conversational invocation. The skill's `description` / `allowed-tools` declaration in `SKILL.md` MUST cover at least these phrases (case-insensitive, fuzzy):

| Phrase pattern | Inferred intent | Example |
|---|---|---|
| `teach me <X>` | Mode A, domain auto-detected from `<X>` | "teach me React hooks" → code |
| `make a course on <X>` | Mode A | "make a course on community-acquired pneumonia" → medicine |
| `make a lesson out of <X>` | Mode A or B (heuristic-decided) | "make a lesson out of this PDF" |
| `lesson from this PDF` | Mode A, source = PDF | medicine or research-paper |
| `case-study this` | Mode B (forces) | any |
| `explain the pattern` | Mode B (forces) | any |
| `chiron <…>` | Generic fallback — let the skill decide | "chiron my repo" |

The bare keyword `chiron` is the unambiguous fallback when natural phrasing is unclear.

### Style B — Slash-commands

Explicit invocation. Each slash-command MUST resolve to the same underlying pipeline as the natural-language equivalent, but with mode/domain pre-filled — bypassing the heuristic.

| Slash-command | Mode | Domain | Notes |
|---|---|---|---|
| `/chiron` | auto | auto | runs heuristic for both axes |
| `/chiron-code` | A | code | |
| `/chiron-medicine` | A | medicine | further sub-mode (AMBOSS vs UpToDate) prompted at run time |
| `/chiron-language` | A | language-it (v1) | post-v1 may add `/chiron-language-de` |
| `/chiron-research-paper` | A | research-paper | |
| `/chiron-case-study` | **B (forced)** | auto | always Mode B regardless of input length |

## Both styles MUST resolve to the same pipeline

A trigger of either style produces a `TriggerContext` object that feeds Stage 0 (Ingest):

```ts
interface TriggerContext {
  raw: string;                   // original user text or slash-command + args
  source: 'natural-language' | 'slash-command';
  domain: 'code' | 'medicine' | 'language-it' | 'research-paper' | 'auto';
  mode: 'A' | 'B' | 'auto';
  modeForcedBy: 'user-flag' | 'slash-command' | null;
  sourceArg: string | null;      // path / URL / inline content reference
  flags: { theme?: string; subMode?: 'amboss' | 'uptodate' };
}
```

`SKILL.md` does not implement this struct directly — it surfaces the trigger to the skill runtime (`chiron/skill/lib/`) which constructs the context.

## Mode-A-vs-B heuristic (when neither is forced)

Per FR-003 and PRD §3 #2:

- Source word count `< 2000` → **Mode B candidate**
- Source word count `>= 2000` → **Mode A candidate**

The skill MUST display the inferred mode and a one-line reason before generation begins. The user MAY override mid-conversation by saying `mode a` or `mode b`.

## Examples (round-trip)

| User says | Resolved `TriggerContext` |
|---|---|
| `teach me hooks in this repo` | `{ source: 'natural-language', domain: 'code' (auto-resolved from "repo"), mode: 'A' (≥2000 words), … }` |
| `/chiron-medicine ./pneumonia.pdf` | `{ source: 'slash-command', domain: 'medicine', mode: 'A', modeForcedBy: null, sourceArg: './pneumonia.pdf' }` |
| `/chiron-case-study this incident-report.md` | `{ source: 'slash-command', domain: 'auto', mode: 'B', modeForcedBy: 'slash-command', sourceArg: './incident-report.md' }` |
| `chiron https://arxiv.org/abs/2026.12345` | `{ source: 'natural-language', domain: 'research-paper' (auto from arxiv), mode: 'A', sourceArg: '<url>' }` |

## Validation (testable)

1. The 4 golden inputs (FR-026) MUST exercise both styles — at least one trigger via natural-language and one via slash-command across the eval rig.
2. The skill MUST refuse `language-de` / German requests in v1 with a clear "deferred to post-v1" message rather than producing an empty/broken lesson.
