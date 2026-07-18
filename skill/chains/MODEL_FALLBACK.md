# Model fallback ladder — one flaky model can't kill a lesson

Every Chiron generation chain authors its content as **JSON emitted by an LLM**, then parses it. When
the model returns malformed JSON, the chain re-prompts (`json_with_repair`). Before this change that
repair loop was **single-model**: if the primary model was having a bad day, the loop exhausted its
retries and the whole lesson died — after having already burned several minutes per attempt.

This is not hypothetical. A real passage-lesson run (`ssm2017_008`, 2026-07-18) logged:

```
[repair] breakdown 1/3: parse failed (Expecting value: line 1 column 1 (char 0)) — re-prompting
[repair] breakdown 2/3: parse failed (Unterminated string starting at: line 285 column 57) — re-prompting
```

Two of three attempts burned, ~4 minutes apart, on a single section. A third failure would have lost
the lesson.

## The ladder

```
primary (per-chain, e.g. glm-5.1)  ──(N JSON-repair tries fail)──▶
  gemma4:31b       (Ollama Cloud)  ──(fail)──▶
    gpt-5-mini     (OpenAI, paid)  ──(fail)──▶
      needs_review  (flagged, chain CONTINUES)
```

- **Local/cloud-free first, paid last.** Matches the house escalation discipline — the paid model is
  a last resort, never a default.
- **Never fatal.** Exhausting the whole ladder flags `needs_review` and keeps going, so one bad
  section can't destroy an otherwise good lesson.
- **Auto-skips the paid tier when unavailable:**
  `FALLBACKS = [m for m in _FB if not (m.startswith("gpt-") and not OPENAI_KEY)]`
  No key → the ladder quietly ends at the free tier instead of failing on an auth error.

## Configuring it

| Env var | Default | Meaning |
|---|---|---|
| `CH_MODEL_FALLBACKS` | `gemma4:31b,gpt-5-mini` | Comma-separated ladder, tried in order after the chain's primary model |

The chain's own primary model is unchanged and is always tried first — this is purely additive.

```bash
CH_MODEL_FALLBACKS="gemma4:31b"                 # free-only, never spend
CH_MODEL_FALLBACKS="gemma4:31b,gpt-5-mini"      # default
CH_MODEL_FALLBACKS=""                           # disable the ladder entirely
```

## Coverage — all 7 chains

| Chain | Domain |
|---|---|
| `2026-06-30_chiron-medical-italian-passage-chain` | passage (SSM MCQ → medical-Italian) |
| `2026-06-30_chiron-pure-italian-lesson-chain` | pure Italian |
| `2026-06-30_chiron-wards-lesson-chain` | medical wards |
| `2026-06-29_chiron-medicine-lesson-chain` | medicine (lesson) |
| `2026-07-05_chiron-medicine-primer-chain` | medicine (primer) |
| `2026-07-06_chiron-medicine-atlas-chain` | medicine (atlas) |
| `2026-07-06_chiron-medicine-systematic-chain` | medicine (systematic) |

**Medicine chains wrap `call_engine(cur, md)`, not the raw model call** — so each fallback model is fed
through the engine layer, and the `CH_CHAPTER_ENGINE=claude` headless-Claude branch is preserved
untouched.

## Operational note

No server restart is required. Each generation spawns `run.py` fresh, so the next lesson picks the
ladder up automatically; in-flight generations finish on the code they started with.

## Cross-references

- `~/.claude/rules/domains/ollama-cloud.md` (R-OC7) — the local-first escalation discipline this follows.
- `~/.claude/rules/domains/chiron.md` — chain/persona map.
