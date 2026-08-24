# Chiron — Portability

`SETUP.md` covers a **fresh install**. This covers a **second machine that should
behave like the first** — same voices, same personas, same library, able to
generate lessons.

> **Convention:** this file uses placeholders (`<BOX>`, `<MAC>`) instead of real
> LAN addresses. This repo is public — keep actual IPs, hostnames and secrets in
> `~/dev/.env` and `~/.chiron/`, never in git. See `skill/chains/MODEL_FALLBACK.md`
> for the same rule applied to `CH_LOCAL_BASE`.

---

## First decide which mode you want

Most people asking "can I run chiron on my laptop?" want mode A, which needs no
install at all.

| | **A — client** | **B — second generator** |
|---|---|---|
| Install | none | full clone |
| Generation runs on | the main box | the laptop |
| Sees your library / voices / corpus | yes, automatically | needs setup below |
| Drift risk | none (one source of truth) | two boxes to keep in sync |
| Works off-LAN | no | partially (see §5) |

### A — laptop as a client

The three chiron services already bind `0.0.0.0`, not loopback:

| Port | Service |
|---|---|
| 8910 | serve (lessons) |
| 8911 | generate (chain dispatcher + publish + static `/lessons/**`) |
| 8912 | tutor (in-page grounded tutor) |

So a second machine on the LAN just opens `http://<BOX>:8911` and generates
lessons **on the main box**, using its voices, library and corpus. The Chiron
app also has a server-address prompt (`library.js` → "Chiron server address")
for pointing a phone or laptop at the box's current LAN IP without a rebuild.

**Nothing to install, nothing to sync, no drift.** Prefer this unless you
specifically need the laptop to run the pipeline itself.

---

## B — laptop as a second generator

### 1. Code

```bash
git clone https://github.com/gyasis/chiron.git && cd chiron
bash skill/scripts/install.sh    # symlink → ~/.claude/skills/chiron, npm install, build, test
bash skill/scripts/doctor.sh     # traffic-light verify
```

`install.sh` resolves paths via `BASH_SOURCE` — no hardcoded locations, and it's
idempotent. Requires Node ≥ 20, bash ≥ 4, git, Claude Code CLI. Node/TypeScript
only — no venv, no pip.

### 2. `~/.chiron/` — the part that is NOT in git

This is the step people forget. `~/.chiron/` lives outside the repo and some of
it is *deliberately* uncommitted:

| Path | What | If missing |
|---|---|---|
| `packs/lucrezia`, `packs/pauls-tutor` | personas — **lucrezia is private and never committed** | no persona; language/ward lessons can't voice |
| `voices.json` | voice → `{refAudio, refText}` registry | bake can't resolve a voice |
| `voice-registry/*.json` | speaker embeddings for the Modal lane | Modal fast-bake refuses (`voice not registered`) |
| `corpus.env` | Postgres DSN + creds (mode 600) | no corpus/study-state |
| `chiron-release.jks` + `chiron-keystore.pass` | Android signing key | **regenerating breaks app updates for existing installs** |
| `library.sources.json` | external library cross-links | those links dead |
| `audio-library/` | shared clip cache | re-synthesis instead of reuse |

Transfer it as a unit (the MacBook is reachable as `ssh macbook`):

```bash
tar czf - -C ~ .chiron | ssh macbook 'tar xzf - -C ~'
ssh macbook 'chmod 600 ~/.chiron/corpus.env ~/.chiron/chiron-keystore.pass'
```

### 3. Credentials

Copy `~/dev/.env` (never commit it). What generation actually reads:

| Var | Used for |
|---|---|
| `OLLAMA_API_KEY` | the **primary** authoring model (`glm-5.1`, Ollama Cloud) |
| `CH_LOCAL_BASE` | governor OpenAI-compat lane — the free `local/*` fallback rung |
| `OPENAI_API_KEY` | the paid last-resort rung only |
| `GEMINI_API_KEY` | **not** in the default ladder — opt-in per run (see below) |

The fallback ladder auto-skips any rung whose credential is absent, so a missing
key degrades the ladder instead of erroring.

### 4. Mac Studio endpoints — nothing to configure on-LAN

Every heavy stage is an HTTP call to the Mac, and the defaults are already
correct on the home LAN:

| Default port | Service | Override |
|---|---|---|
| 8770 | omnivoice TTS (primary) | `audio-bake.ts` opts |
| 8769 | Dia TTS (expressive) | `audio-bake.ts` opts |
| 8766 | whisper ASR — word alignment | `CHIRON_WHISPER_URL` / `CHIRON_ASR_URL` |
| 8767 | diarize | `CHIRON_DIARIZE_URL` |
| 8768 | audio LLM | `CHIRON_AUDIO_LLM_URL` |
| 8799 | Atelier governor (VLM, embeddings) | `CHIRON_VLM_URL`, `ATELIER_GOVERNOR` |
| 8782 | pronounce (scoring) | — |

**On the same LAN there is nothing to set.** These only matter if the Mac moves.

---

## Voice references — already shared, nothing to copy

`voices.json` maps each voice to a path like
`/Users/<macuser>/models/voice-refs/<voice>_ref.wav`. Those are **Mac-side paths
read by the omnivoice sidecar**, not files the client opens. Any machine that can
reach the TTS port names a voice and gets byte-identical audio.

So voice consistency across machines is free and cannot drift. The one exception
is the Modal lane (below), which needs the speaker embedding in
`~/.chiron/voice-registry/`.

---

## The one real gap: corpus Postgres is loopback-only

The corpus DB binds `127.0.0.1:5442` — a second machine **cannot reach it**.

- **Generating** a lesson: unaffected. The corpus is not on the generate path.
- **Accepting / publishing** with study-state ETL: needs the DB.

Options, in order of preference:

1. **Publish through the main box's `:8911`** — no infra change. Recommended.
2. Re-bind the container to the LAN (`-p <BOX>:5442:5432`). It currently sits
   behind a loopback-trust assumption, so do **not** do this without setting a
   real password first.

---

## §5 Off-LAN reality

Generation is LAN-bound today. Off the home network:

| Stage | Off-LAN |
|---|---|
| Authoring (text/LLM) | ✅ works — Ollama Cloud + OpenAI are internet services. The `local/*` rung self-skips when `CH_LOCAL_BASE` is unreachable |
| Assembly (compose, assemble, slice) | ✅ deterministic and local |
| Audio bake | ❌ Mac TTS unreachable (unless Modal — see below) |
| Word alignment | ❌ whisper `:8766` has no cloud fallback |
| Figure captioning / VLM | ❌ governor unreachable |
| Reading existing lessons | ✅ `.chiron` bundles are self-contained |

There is no tunnel standing (Tailscale on the Mac is logged out), so "off-LAN"
currently means "authoring only".

### The Modal lane

`CH_BAKE_ENGINE=modal` fans synthesis out to a Modal L4 GPU and splices locally —
byte-identical to a Mac bake, just faster. Two caveats:

- It **does not** fall back to the Mac on failure (deliberate — avoids
  contention). A Modal outage fails the bake cleanly rather than silently
  degrading.
- It requires the voice to exist in `~/.chiron/voice-registry/`. Today that holds
  only the episode speakers, **not** the lesson personas — so Modal is a speed
  lane for `video-it` episodes, not yet a Mac replacement for lessons.

---

## Lessons and content

Lessons live in `~/Documents/generated/chiron-*/`, **outside the repo**
(~18 GB total). They are not a sync problem by design:

- `.chiron` is a plain ZIP, everything relative to the zip root — see
  `skill/CHIRON-FORMAT.md`.
- `skill/scripts/bundle-lesson.sh` produces one.
- A bundle opens on any machine or in the app with no server.

Move individual lessons as bundles; don't try to rsync the whole tree.

---

## Cost discipline on a second box

A fresh machine is exactly where a bad default gets expensive. Before a bulk run:

```bash
CH_MODEL_FALLBACKS="local/gemma4:12b,deepseek-v4-flash"   # free rungs only, no paid rung
# CHIRON_AUDIO_QC is OFF by default — set =1 only for a sample bake, never a bulk one
```

Gemini is deliberately **out** of the default ladder: a silent `gemini-flash`
rung fired 295 times over 2026-07-19/20 and drove a ~$225 two-day bill. Opt in
per-run, never as a default. Full history: `skill/chains/MODEL_FALLBACK.md`.

---

## Verify the second machine

```bash
bash skill/scripts/doctor.sh
ls ~/.chiron/packs/                      # personas present?
node -e "console.log(Object.keys(require(process.env.HOME+'/.chiron/voices.json')))"
curl -sS -m5 http://<MAC>:8770/healthz   # TTS reachable?
curl -sS -m5 http://<MAC>:8766/healthz   # whisper reachable?
```

Then generate one short lesson end-to-end before trusting it with a batch.

---

## Cross-references

- `SETUP.md` — fresh install
- `skill/CHIRON-FORMAT.md` — the `.chiron` bundle format
- `skill/chains/MODEL_FALLBACK.md` — the model ladder and its cost history
- `skill/MOBILE-GUIDE.md` — the phone app
- `skill/scripts/AGENT_INSTALL.md` — let a Claude Code session drive the install
