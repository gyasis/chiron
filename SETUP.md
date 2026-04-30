# Chiron — Fresh Clone Setup

How to bootstrap chiron in **any new Claude Code session** — fresh machine, new
git clone, or another contributor's environment.

## TL;DR

```bash
git clone <chiron-repo-url> chiron && cd chiron
bash skill/scripts/install.sh    # symlinks skill into ~/.claude/skills/chiron
cd skill && npm install && npm run build
cd ..
# Test the harness without LLM:
bash skill/tests/test.sh
```

That's it. The skill is now invocable from any Claude Code session via `/chiron`,
`/chiron-code`, `/chiron-medicine`, `/chiron-language`, `/chiron-research-paper`,
or `/chiron-case-study`.

---

## What you'll need on the host machine

| Requirement | Why | Verify |
|---|---|---|
| **Node ≥ 20** | TypeScript build, `node:fs`/`node:path`/`fetch`, ESM `import.meta.url` | `node --version` |
| **bash ≥ 4** | `test.sh`, `build.sh`, `install.sh` — uses associative arrays | `bash --version` |
| **git** | source checkout + `git rev-parse HEAD` for code-repo ingest | `git --version` |
| **Claude Code CLI** | the parent agent — Chiron is a Claude Code skill, not a standalone | `claude --version` |
| **(Optional) jq** | nicer `test.sh` JSON diffs (falls back to python3) | `jq --version` |
| **(Optional) playwright/chromium** | full FR-026 lesson.html DOM inspection (falls back to grep) | — |

You do NOT need:
- An Anthropic SDK / Google AI SDK install — Q8 architecture: the parent
  Claude Code agent runs all text-LLM steps in its own context.
- A separate Anthropic API key beyond what your Claude Code session already has.
- An LLM provider for chiron-the-build to function — only for chiron-the-runtime
  to actually generate lessons.

---

## Step-by-step

### 1. Clone and install

```bash
git clone <chiron-repo-url> chiron
cd chiron
bash skill/scripts/install.sh
```

`install.sh` resolves the skill source via `BASH_SOURCE` (no hardcoded paths)
and creates `~/.claude/skills/chiron → <clone>/skill`. Idempotent — re-running
reuses the existing symlink.

### 2. Build the TypeScript

```bash
cd skill
npm install        # zod, better-sqlite3, pdfjs-dist, pdf-to-img
npm run build      # tsc → dist/
```

If `npm install` fails on `better-sqlite3`, you may need `python3` and a C++
compiler available — see better-sqlite3's README for platform-specific build
deps.

### 3. Verify the harness

```bash
cd ..
bash skill/tests/test.sh
```

Expected output: 5 standard inputs + 1 Mode-B input all SKIP cleanly (no
`lesson.html` exists yet because no lesson has been generated). `pass=0
fail=0 skip=6 total=6 → exit 0`. **This is the build-time PASS.** Real
end-to-end testing requires an LLM in the loop.

### 4. (Optional) verify the Q8 invariant

```bash
grep -rE "@anthropic-ai/sdk|@google/generative-ai" skill/
```

Should return ZERO matches. If any appear, it's a regression — the skill must
not depend on any LLM SDK.

---

## What lives where

```
chiron/
├── README.md                — repo overview (link hub)
├── SETUP.md                 — this file
├── CLAUDE.md                — Claude Code agent guardrails (loaded automatically)
├── skill/                   — the deployable skill bundle
│   ├── SKILL.md             — top-level skill descriptor (entry-point manifest)
│   ├── README.md            — user-facing how-to + extensibility doc
│   ├── package.json         — Node deps
│   ├── lib/                 — TypeScript libs (pipeline, validators, schemas)
│   ├── ingest-adapters/     — per-source-type adapters (PDF, code-repo, etc.)
│   ├── prompts/             — markdown templates the parent agent loads
│   ├── concepts/            — per-domain concept DAGs (JSON)
│   ├── curricula/           — per-domain curriculum settings (JSON)
│   ├── personas/            — per-domain personas (JSON)
│   ├── shell/               — single-file lesson.html shell + vendored libs
│   ├── tests/               — golden-input regression rig
│   └── scripts/install.sh   — portable symlink installer
├── memory-bank/             — project memory (architecture, patterns, context)
├── prd/                     — design PRDs
│   ├── chiron_design_v1_2026-04-28.md
│   └── universal_lesson_generator_2026-04-28.md
└── specs/001-chiron-v1/     — SpecKit feature spec + tasks.md
```

## What's NOT in this repo

| File | Why missing | Where to look |
|---|---|---|
| `node_modules/` | gitignored | run `npm install` |
| `skill/dist/` | gitignored | run `npm run build` |
| `~/dev/audits/codebase-to-course/`, `classbuild/`, `ai-course-generator/` | heritage repos audited separately | repo READMEs reference these as historical context only — Chiron does not depend on them at runtime; the relevant code was forked into `skill/shell/` already |
| `~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md` | TTS provider PRD lives in the user's PRD librarian | tracks the deferred T058 audio-tts decision |

---

## Operating instructions for a fresh Claude Code session

When a contributor opens chiron in Claude Code for the first time:

1. **Read `CLAUDE.md`** — the agent loads it automatically. It declares the
   foundational facts (3 co-equal domains, single-learner, multi-persona
   content layer) and the Mode A vs B distinction.
2. **Read `skill/SKILL.md`** — the skill's entry-point manifest, including all
   trigger phrases and slash-commands.
3. **Read `skill/README.md`** — the user-facing quickstart and the per-domain
   3-file drop process for US6 extensibility.
4. **(Optional) read `prd/chiron_design_v1_2026-04-28.md`** — full design
   rationale for §11 decisions (Q1–Q11 clarifications).
5. **(Optional) read `memory-bank/projectbrief.md`, `systemPatterns.md`,
   `techContext.md`, `activeContext.md`** — evolving project state notes.

Then to actually generate a lesson, invoke from a Claude Code session:

```
teach me React hooks from this repo: ./my-react-app
```

or

```
/chiron-medicine ./pneumonia-chapter.pdf
```

The parent Claude agent runs the 5-stage pipeline (ingest → brief → syllabus
→ validate → build → assemble) using the prompt templates in
`skill/prompts/`. Output lands in a fresh `<lesson-output-dir>/` with a
single self-contained `lesson.html` plus a per-lesson SQLite state DB.

---

## Adding a new domain (US6 extensibility)

Drop 3 files (no pipeline-code edits needed):

```
skill/concepts/<domain>.json     — concept DAG (no cycles, valid prereqs)
skill/curricula/<domain>.json    — chapter targets, widget mix, theme id
skill/personas/<domain>.json     — { expert, peers[] }
```

See `skill/README.md` for the worked music-theory example and the validator
checks that fire on each drop.

---

## Open caveats (read these before you assume something works)

1. **TTS / audio is tabled.** Italian native-speaker dialog will produce
   `<audio>` tags, but no MP3 will be at the path until a TTS provider is
   selected. See `~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md`.
2. **Browser safety hardening incomplete.** T162-T165 (eval sandbox, innerHTML
   sanitization, SRI hashes, RDKit SVG sanitize) are deprioritized for v1.
   Single-learner / local-file context — but lessons should NOT be opened in
   a browser session that holds sensitive credentials until these land.
3. **No real LLM-driven end-to-end test has been run.** The harness (`test.sh`)
   validates structure and SKIPs when `lesson.html` is absent. The pipeline
   itself was built without an LLM in the loop. Expect bugs in the actual
   prompt-driven stages on first run; iterate via the FR-006 retry loop.
4. **RDKit-JS WASM not bundled.** Molecule rendering requires
   `skill/shell/vendor/molecule-renderer/RDKit_minimal.js` + `.wasm`. README
   in that dir documents the install step. Falls back gracefully if missing.

---

## Known follow-ups

`specs/001-chiron-v1/tasks.md` tracks the full task ledger (177/182 done).
The 5 unchecked tasks are:

- **T058** audio-tts widget — tabled to TTS PRD
- **T162–T165** browser-safety quartet — deprioritized

There are no other ship-blockers. The pipeline can be invoked end-to-end and
the skill is registered. Whether the LLM produces a good lesson on first try
is empirical — that's what `tests/golden-inputs/` and `tests/snapshots/` are
for.
