# Audit: JulienAvezou/ai-course-generator

**Date:** 2026-04-28
**Audited at:** `~/dev/audits/ai-course-generator/`
**Repo:** https://github.com/JulienAvezou/ai-course-generator
**License:** MIT (Copyright (c) 2026 Julien Avezou)
**Tech stack:** TypeScript monorepo (Next.js 15, React 19, Node.js 22, Prisma + PostgreSQL, GitHub API, OpenAI/Anthropic)

---

## What it is

A multi-tenant local web app that scaffolds beginner-friendly code courses, manages student PRs, and uses LLMs as advisory PR reviewers. Notable for the **deterministic concept dependency graph + LLM-as-advisor-not-arbiter** architectural pattern.

---

## Monorepo layout (pnpm workspaces — 2 apps + 6 packages)

| Path | Role |
|---|---|
| `apps/web` | Next.js 15 UI + REST APIs under `app/api/{course-instances,course-templates,custom-courses,github,health,jobs,llm,webhooks}` |
| `apps/worker` | Long-running poller. Owns the **job queue** in Postgres (table `jobs`) — pulls `PENDING` rows and dispatches scaffold / GitHub-sync / PR-review / custom-course-gen jobs |
| `packages/core` | Prisma client + structured logging + shared utils |
| `packages/standards` | The progression brain. Holds the **concept dependency graph**, the milestone state machine, course-plan validator, skill rubrics. Pure functions, no IO. |
| `packages/jobs` | Job processors: `scaffold-repo-job`, `github-sync-job`, `github-event-processor`, `review-pr-job`, `generate-custom-course-job`, `milestone-validation` |
| `packages/llm` | LLM gateway (caching + secret scan + token estimation) and direct OpenAI/Anthropic HTTP fetchers |
| `packages/github` | Webhook + CI-result parsing |
| `packages/archetype` | A 902-line `template.ts` that hard-codes the starter project files (one course family) |

---

## Data model (`packages/core/prisma/schema.prisma`)

Key entities:
- `CourseTemplate` → `CourseTemplateVersion` (immutable, version-pinned per learner) → `CourseTemplateMilestone[]` with `position` (ordered) + `primaryConcept` + `conceptsJson`
- `CourseInstance` (one learner × one template-version × one GitHub repo)
- `MilestoneState` (the runtime state per learner per milestone, enum `LOCKED/READY/IN_PROGRESS/PR_OPEN/CHANGES_REQUESTED/DONE`)
- `MilestoneEvidence` (1..n PRs attached to a milestone)
- `MilestoneHint` (level 1..N hints, revealed manually)
- `ConceptMastery` (`(userId, conceptId)` composite PK + `source`) — sparse, written when concepts are deemed mastered
- `LearningEvent` (event log: PR_OPENED, CHECK_RUN_COMPLETED, PR_FAILED_CI, PR_MERGED, etc.)
- `LlmUsage` (per-call token + cache + status row), `Job`, `StructuredLog`, `GithubConnection` (encrypted PAT), `GithubEvent` (webhook idempotency)

**The concept dependency graph is NOT in Postgres.** It lives as a checked-in JSON file at `packages/standards/standards/concepts/web-beginner.json` (and `ts.json`). Schema is `{ conceptId: [prereqConceptIds] }`. 60 concepts in `web-beginner.json`. This is loaded at compile-time by `course-plan-validator.ts`.

**Mastery threshold / confidence score: does not exist.** `ConceptMastery` is binary (row exists or doesn't). No score, no decay, no spaced-repetition machinery anywhere. This is the gap Chiron fills with SQLite-backed SR + numeric mastery.

---

## The progression engine — verified concretely

`packages/standards/src/milestone-progression.ts` is a **pure finite state machine** — 6 states × 3 events (`PR_OPENED`, `CHECKS_FAILED`, `PR_MERGED`) → next state, in a hardcoded transition table. **No LLM input. No graded gate. No "score >= threshold."**

The "graph" used at runtime for progression is **not** the concept DAG — it's the linear `CourseTemplateMilestone.position` ordering. When a milestone goes `→ DONE`, `shouldUnlockNextMilestone()` returns true and the next ordinal milestone flips `LOCKED → READY`.

The concept DAG (`web-beginner.json`) is consulted **only at course-authoring time** by `validateCoursePlan()`: it walks milestones in order, accumulates a `Set<introducedConcepts>`, and flags `unsatisfied_prerequisites` if a milestone introduces concept C before all of `prereqs(C)` have been introduced.

**So the DAG is a build-time topological-sort sanity check on the milestone sequence, NOT a runtime gating mechanism.**

What happens on milestone failure? `CHECKS_FAILED` event → state goes `PR_OPEN → CHANGES_REQUESTED` (or stays `READY` if the PR was never opened). Nothing else. No cooldown, no remediation lesson injected, no concept demotion.

---

## The PR review loop (`packages/jobs/src/review-pr-job.ts`)

1. Worker poller picks up a `REVIEW_PR_JOB` (queued via webhook ingest or `/review` PR comment)
2. Loads `CourseInstance`; **bails if `aiModeEnabled=false` or LLM keys missing**
3. Resolves a per-repo encrypted token, falls back to `GITHUB_SCAFFOLD_TOKEN`
4. **Idempotency:** lists existing PR comments and bails if any contain marker `<!-- coding-course-generator-ai-review sha=<headSha> trigger=<auto|comment> ... -->`
5. Fetches PR metadata + the **diff** via `accept: application/vnd.github.v3.diff`. Never clones the repo, never reads full files — diff only.
6. **Diff trimming** (`trimDiffForReview`): splits on `diff --git` boundaries, drops lockfiles / `dist/` / `coverage/` / `node_modules/` / `.tsbuildinfo`. Greedy fills sections into a token budget (12K input − 300 safety − prompt cost). Truncates last section with `@@ review diff truncated locally @@`.
7. Prompt instructs strict JSON `{"summary","issues","suggestions"}`, "bias toward bugs/regressions before style"
8. On `TokenLimitExceededError`, retries once at 65% of original limit
9. Parses JSON, renders Markdown, posts via `POST /issues/:n/comments`

**Footer on every review:** *"_Advisory only. Milestone validation and merge rules still control progression._"**

**LLM verdict: pure advisory.** The review is posted to the PR thread for the human. Progression is driven entirely by GitHub's required-check status and merge state. The LLM never writes to `MilestoneState`, never emits a `MILESTONE_COMPLETED` event, never even reads the milestone schema.

---

## LLM gateway hardening (`packages/llm/src/index.ts`)

Concrete patterns — `LlmGateway.generateText()`:

1. **Token estimate**: `Math.ceil(content.length / 4)`. Crude but consistent.
2. **Secret scan FIRST** (line 198, before any cache or provider call). Six regex patterns: PEM blocks, `gh[pousr]_...`, `sk-...` (OpenAI), `AKIA...` (AWS), `xox[baprs]-...` (Slack), generic `api_key="..."` assignment. On hit → record `SECRET_SCAN_FAILED` row in `LlmUsage` + throw `SecretScanError`. Provider is never called.
3. **Token-limit gate** (line 218): pre-call check against `inputTokenLimit` (default 12K). On overflow → record `TOKEN_LIMIT_EXCEEDED` row + throw.
4. **Two-tier cache** keyed by `sha256({provider, model, prompt, diff, maxOutputTokens})`: in-memory `Map`, then Postgres `LlmUsage` lookup with `status=SUCCESS, responseText IS NOT NULL`. Hits write a fresh `LlmUsage` row with `cacheHit=true`.
5. Every call (success / error / blocked) writes one `LlmUsage` row + one `StructuredLog` row.

The provider executor itself (`runtime.ts`) directly hits `https://api.openai.com/v1/responses` and `https://api.anthropic.com/v1/messages` — no SDK, plain `fetch`.

---

## Course generation — two paths

### Curated courses (default) — fully human-curated

`pnpm db:seed` runs `apps/web` seed scripts that insert one base template (slug `personal-library-tracker-js-beginner-8w`) — milestones, hint text, validations, archetype reference. The "starter project" itself is generated from `packages/archetype/src/template.ts` — a 902-line file that hardcodes every file (package.json, server.js, README, etc.) for that one course family. **Template-driven, not LLM-driven.**

### Custom courses (`/courses/custom`) — LLM-driven but reuses curated archetype

`generate-custom-course-job.ts`:
1. Loads the base template's milestones + concepts as scaffolding
2. Asks the LLM (via `generateConfiguredText`) to produce strict JSON `{course, milestones[]}` with extra fields per milestone (`why_this_matters`, `failure_mode`, `investigation_prompts`, `signals_to_observe`, `reflection_prompt`, `observable_success_signals`, `hint_levels`)
3. **Validates against a schema + the concept-DAG validator + the skill rubric** (`SKILL_RUBRICS` for `debugging`, `error_handling`)
4. **Retries up to 3 times on validation failure**, feeding the issues back to the LLM. If still invalid → fail the job
5. The validator output, not the LLM, is the gate

Currently only two `SkillIntent` values supported (`debugging`, `error_handling`), overlay onto one fixed JS scaffold family. Course generation is narrow.

---

## What Chiron takes verbatim

1. **Concept DAG as a build-time validator, not a runtime arbiter.** Static `concept → [prereqs]` JSON checked into `concepts/<domain>.json`. Used inside `validateCoursePlan()` to topologically sort that a generated lesson plan introduces concepts in valid prerequisite order. Runtime progression is a tiny separate FSM over linear milestone position.
2. **The LLM-output validation loop with retries** (`generate-custom-course-job.ts`): 3 attempts, schema + concept-DAG + rubric checks, structured issue list fed back to the model.
3. **The LLM gateway** (~250 lines, isolated, dependency-light): SHA-256 request-hash cache + token pre-flight + secret regex scan + per-call usage row. Lift wholesale, swap Prisma for SQLite.
4. **"LLM as advisor not arbiter" — VERIFIED CONCRETELY in code.** The FSM in `milestone-progression.ts` makes zero LLM calls. The PR review job ends with a comment whose footer literally says *"Milestone validation and merge rules still control progression."* The advisor/arbiter line is enforced by the architecture itself: the LLM gateway has no write path into `MilestoneState`. **Worth inheriting as a hard rule.**

## What Chiron rejects (over-engineering for solo learner)

- ❌ Postgres + Prisma + multi-user schema. `User`, `Profile`, `GithubConnection`, `Job` queue, `LlmUsage` table — all are infrastructure for multi-tenant local server. Solo-learner HTML lesson generator wants single SQLite or even flat JSON.
- ❌ GitHub PR loop and the entire `apps/worker` poller. Locks you to a code-only domain; useless for medicine MCQs, language drills.
- ❌ The 902-line hand-rolled scaffold archetype (`packages/archetype/src/template.ts`) — one course family hardcoded in TS. Doesn't scale to N domains.

## Gaps Chiron must fill

- **HTML output** — no rendering anywhere. Output is GitHub PR Markdown comments + Next.js DB-backed pages.
- **Non-code domains** — concept DAG is generic in shape but the *content* (`web-beginner.json`, `ts.json`) and the entire scoring path (PR diff → CI check) are code-only.
- **Quizzes & scoring** — no `Quiz`, `Question`, `Answer`, or `Attempt` entities in the schema. The "submission" primitive is *exclusively* a GitHub PR.
- **Spaced repetition** — completely absent. `ConceptMastery` is binary, no `lastReviewedAt`, no `nextDueAt`, no SM-2/FSRS-style scheduling.
- **Confidence/mastery score** — Mastery is a row-or-not flag. Need numeric scoring + decay.

---

## Files & paths

- Local clone: `/home/gyasisutton/dev/audits/ai-course-generator/`
- Key files: `packages/core/prisma/schema.prisma`, `packages/standards/src/milestone-progression.ts`, `packages/standards/src/course-plan-validator.ts`, `packages/standards/standards/concepts/web-beginner.json`, `packages/llm/src/index.ts`, `packages/jobs/src/review-pr-job.ts`, `packages/jobs/src/generate-custom-course-job.ts`
- Audited HEAD commit: clone date 2026-04-28 ~12:35
