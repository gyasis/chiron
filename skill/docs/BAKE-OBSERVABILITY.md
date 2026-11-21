# Bake observability — status, history, lock, exit codes

What a bake leaves behind, and what it tells a caller when it goes wrong.

Origin: on 2026-11-20 I baked four lessons in parallel. Each run silently dropped
its two longest clips (the full lecture and one dialogue) and still exited 0. The
harness, SIO and the Chiron app all saw success. Every TTS call goes to ONE
OmniVoice sidecar, so four bakes competed for it. The longest artifacts ran out
of retries first.

---

## Exit codes

| code | meaning |
|---|---|
| `0` | every planned artifact has a clip on disk |
| `1` | precondition failure (bad args, missing lesson.html, unknown voice) |
| `2` | **clips missing** — the lesson is incomplete; `--allow-partial` downgrades this to 0 |
| `3` | could not get the TTS lock within `CH_BAKE_LOCK_WAIT` |

A caller must branch on the exit code, not on the phrase "0 defects". QC grades only
the clips a run produced: a run that drops two clips reports zero defects
among the forty-six that survived.

---

## Files written into `<lesson>/audio/`

| file | lifetime | contents |
|---|---|---|
| `bake-status.json` | overwritten every run | `{complete, ts, planned, produced, missing[], failures[]}` — the current truth, safe to poll |
| `bake-report.json` | **append-only** | one entry per run: planned/baked/reused/failed, plus each failure with its artifact, sectionId, status and error text |
| `incomplete.json` | written when clips are missing, removed when a later run completes | the missing list and the errors behind it |
| `qc-report.json` | per QC | surviving defects, read by the lesson page's ℹ️ badge |

History matters more than current state here. A recovery run previously upserted
`done` over a failed row and nulled its `error`, erasing the only durable record
of what went wrong. `bake-report.json` keeps every run, so a recovery adds a line
instead of replacing one.

---

## The TTS lock

Bakes serialize on `~/.chiron/bake.lock` (JSON: pid, host, lessonDir, startedAt).

- A second bake **queues** and logs `another bake holds the TTS lock … — queueing`.
- A lock whose pid is gone, or that is older than three hours, counts as debris
  and gets removed.
- `CH_BAKE_LOCK_WAIT` (seconds, default 1800) bounds the wait.
- `CH_BAKE_LOCK_PATH` relocates the lock.

The lock is **local**. Two different machines baking at once still share one sidecar; only
a queue on the TTS host itself fixes that.

---

## Retry budget

`synthAttemptsFor(segmentCount)` = `3 + ceil(segments / 20)`, capped at 8. A
one-segment phrase gets 3 tries; a 60-segment lecture gets 6. Long artifacts have
more chances to meet a stall, so they persist longer.

---

## Environment

| var | effect |
|---|---|
| `CH_OMNIVOICE_URL` | point at another TTS host (or a dead port, to exercise the failure path) |
| `CH_BAKE_LOCK_WAIT` | seconds to queue for the lock |
| `CH_BAKE_LOCK_PATH` | lock file location |
| `CH_BAKE_ENGINE=modal` | bake on the Modal lane instead of the Mac sidecar |

---

## Checking a bake

```bash
node skill/scripts/bake-lesson-audio.mjs <lesson-dir>; echo "exit=$?"
python3 -c "import json;print(json.load(open('<lesson-dir>/audio/bake-status.json')))"
python3 -c "import json;print(json.load(open('<lesson-dir>/audio/bake-report.json'))[-1])"
```

Do not pipe a long bake through `tail`: the error lines are on stderr, and the
task log is the only place they appear live.
