# Chiron — Agent-Assisted Install Playbook

**Audience:** a Claude Code (or other coding-agent) session on a *fresh machine*.
**Goal:** clone → install → verify Chiron is healthy and usable, with the agent
interpreting results and fixing problems — not just blindly running a script.

**Human shortcut:** if you just want to do it yourself, run `npm run setup`
then `npm run doctor` from `skill/`. Everything below is for telling an agent
"set up Chiron on this machine" and having it drive the process.

---

## Copy-paste trigger (give this to the fresh-machine agent)

> Set up the Chiron skill on this machine. Follow
> `skill/scripts/AGENT_INSTALL.md`: run the installer, then the doctor, read the
> doctor's traffic-light output, fix any ✗ FAILs, and confirm the skill is
> discoverable and the build is healthy. Report the verdict and the one known
> open task. Do NOT touch the `lessons/` directory — it's private/local.

---

## What Chiron is (so the agent sets expectations right)

- A **Claude Code skill** (Node/TypeScript), not a standalone app. The parent
  Claude session runs all text-LLM steps (Q8 architecture) — there is **no
  Anthropic/Google SDK to install and no separate API key** needed for the
  build to be healthy. Only generating an actual lesson needs the live Claude
  Code session.
- **No Python venv.** All deps are Node packages in `skill/package.json`.
- Output is a single self-contained `lesson.html` + a per-lesson SQLite DB.

---

## Step 1 — Prerequisites (agent verifies, does not assume)

Required: **Node ≥ 20**, **npm**, **bash ≥ 4**, **git**, **Claude Code CLI**.
Optional: `jq` (nicer test diffs), RDKit-JS WASM (molecule rendering).

The agent should run `node --version`, `npm --version`, `git --version`,
`claude --version` and, if any are missing, STOP and tell the user how to
install them (don't try to install Node itself unsupervised).

## Step 2 — Install

```bash
cd <repo>/skill
npm run setup          # = bash scripts/install.sh
```

`install.sh` is idempotent: it checks Node, symlinks `skill/` →
`~/.claude/skills/chiron`, runs `npm install`, builds TypeScript to `dist/`,
and sanity-checks the test harness. Re-running is safe.

## Step 3 — Doctor (the verification gate)

```bash
npm run doctor         # = bash scripts/doctor.sh
```

The agent **reads the traffic-light report** and acts on it:

| Marker | Meaning | Agent action |
|---|---|---|
| `✓` | check passed | nothing |
| `⚠` | warning (allowed) | note it; do NOT treat as failure |
| `✗` | REQUIRED check failed | fix it (see remediation), then re-run doctor |

**Exit code is the gate:** `0` = healthy (warnings OK), `1` = at least one
FAIL. The agent loops fix → `npm run doctor` until exit 0.

### Expected warnings on a clean install (NOT failures)
- `molecule-renderer WASM not bundled` — optional; molecule widgets degrade gracefully.
- `TTS / audio is TABLED` — the known v1 gap (see Step 5).
- `claude CLI not found` — only if Claude Code isn't installed; build is still healthy, but lesson generation won't run until it is.

### Common FAILs → remediation
| FAIL | Fix |
|---|---|
| `node ... requires Node >= 20` | install Node 20+ (`nvm install 20` / `brew install node`), re-run setup |
| `no skill symlink` / `points elsewhere` | re-run `npm run setup` |
| `node_modules missing` / `dep missing` | `cd skill && npm install` |
| `dist/ missing or empty` | `cd skill && npm run build` |

## Step 4 — Confirm usable

Doctor exit 0 means: symlink in place, deps installed, `dist/` built, harness
green, SKILL.md present. From any Claude Code session the skill is now
invokable: `/chiron`, `/chiron-code`, `/chiron-medicine`, `/chiron-language`,
`/chiron-research-paper`, `/chiron-case-study`, or natural-language ("teach me X").

## Step 5 — The one known open task (surface it)

**TTS / audio (issue [gyasis/chiron#2](https://github.com/gyasis/chiron/issues/2), task T058)** is the
only open v1 build item. Italian native-speaker dialog emits `<audio>` tags but
no MP3 lands until a provider is selected. The decision criteria live in
`chiron_tts_provider_selection_2026-04-29.md` (carry it to this machine if it's
not in the repo). Everything else (issues #3 Lesson Expander, #4 Server/CMS) is
future-roadmap, not blocking.

## Hard rules for the agent

- **Never commit or modify `lessons/`** — private/local to each machine.
- Don't install Node/system packages without user OK.
- Don't paste API keys anywhere — none are needed for install.
- If doctor still FAILs after the remediation table, report the exact ✗ lines
  to the user rather than improvising.
