# System Patterns

**Purpose**: Architecture patterns and design decisions

## Ralph Principles (LLM Smart Zone Optimization)

**Core Insight**: LLMs perform best in short, fresh bursts, not long conversations.

### The Two-Zone Problem
- **Smart Zone**: First 30-40% of context (focused, precise, good decisions)
- **Dumb Zone**: Beyond 40% of context (confused, error-prone, degraded quality)

### How This Project Implements Ralph
1. **Frequent Git Commits**: Externalize state to git, not conversation memory
2. **Wave-Based Execution**: Each wave = one iteration (discrete work unit)
3. **Memory Bank as PRD**: Requirements persist outside context window
4. **Session Snapshots**: Resume points without context bloat
5. **GitHub Issues as Tasks**: External tracking enables crash recovery

### Agent Guidelines (CRITICAL)
✅ **DO**:
- Commit to git after EVERY logical change (not just wave completion)
- Read git history + Memory Bank instead of scrolling conversation
- If context feels bloated (>80K tokens), finalize and recall
- Complete one wave, then checkpoint
- Trust the codebase as memory, not conversation history

❌ **DON'T**:
- Try to remember everything in conversation
- Do multiple waves in one session
- Continue when context approaches 100K tokens
- Skip commits to "batch" changes

### Context Budget Targets
- **Optimal**: <60K tokens (30% of 200K window)
- **Warning**: 60-80K tokens (30-40%)
- **Critical**: >80K tokens (>40% - finalize immediately)

## Architecture Patterns
- [Pattern 1]: [When to use]

## Design Decisions
- [Decision 1]: [Rationale]

## Known Gotchas
- [Gotcha 1]: [How to avoid]

## Integration Sentinel

**Purpose**: Per-task micro-agent test-and-fix loop injected after each wave task completion. Validates task output before wave checkpoint is committed to git.

### Sentinel Task Injection Flow

```
orchestrator.py: _assign_waves()
  └─ if sentinel.enabled:
       └─ _inject_sentinel_tasks()
            ├─ Insert SENTINEL-<task_id> after each regular task in plan
            ├─ Set agent_role="Sentinel", dependencies=[task_id]
            └─ Append "- [ ] SENTINEL-<id>: ..." to tasks.md

wave_executor.py: execute_task()
  └─ if task["agent_role"] == "Sentinel":
       └─ SentinelRunner(config, project_root).run(task)
            └─ if result.should_halt_wave: raise WaveHaltError
```

**Bootstrap invariant**: `sentinel.enabled: false` during sentinel's own build. Zero SENTINEL tasks in execution_plan.json during this build.

### Manifest-Always-Written Invariant

Every sentinel run writes three files to `.claude/sentinel/<SENTINEL-ID>/` using try/finally:

```
manifest.json  → Structured record (result, tier, iterations, cost, files changed)
diff.patch     → git diff HEAD output (empty if no changes)
summary.md     → Human-readable summary → injected into next task's context
```

The invariant: **manifest is written even on FAIL or ERROR**. `ManifestWriter.write()` is called in a `try/finally` block in `SentinelRunner.run()`. This ensures complete audit trail regardless of outcome.

### Cascade Radius Decision Tree

```
After test loop completes (PASS or FAIL):
  ├─ InterfaceDiff.compare() for each modified file
  ├─ ChangeRadiusEvaluator.evaluate(files, interface_reports, execution_plan)
  │    Check three axes:
  │    ├─ files_changed_count > max_files (default 3)?  → violation: "files"
  │    ├─ lines_changed_total > max_lines (default 150)? → violation: "lines"
  │    ├─ interface_changes > 0 and not allow_interface? → violation: "interface"
  │    └─ modified file in other wave's file_locks?      → violation: "cross_wave"
  │
  └─ if budget_exceeded:
       ├─ mode=auto → CascadeAnalyzer.annotate_tasks()
       │              Appends [SENTINEL CASCADE WARNING] block to pending tasks in tasks.md
       │              Only targets incomplete tasks (- [ ]), skips completed ([x])
       └─ mode=human-gated → cascade_human_gated()
                              Prompt: [a]uto-apply / [r]eview-and-halt / [h]alt
                              r or h → raise WaveHaltError
                              a → call annotate_tasks()
```

### Tiered Model Strategy

| Tier | Model | Constraint | Cost | Trigger |
|------|-------|-----------|------|---------|
| 1 | Ollama `qwen3-coder:30b` @ localhost | max 5 iterations, timeout 300s | Free | Always first |
| 2 | `claude-sonnet-4-20250514` | max 10 iter, $2 budget, 10 min | Cloud | Tier 1 FAIL or Ollama unreachable |

**Ollama availability**: Checked via `curl -sf {url}/api/tags` with 5s timeout before each Tier 1 attempt. If unavailable, skip Tier 1 and go directly to Tier 2 (returns `TierResult(attempted=True, skipped=True)`).

### Placeholder Scanner Pattern

Built-in patterns (13 total, always compiled as regex, case-insensitive):
- `TODO`, `FIXME`, `HACK`, `XXX`
- `NotImplementedError`, `raise NotImplementedError`
- `mock_` prefix (matches `mock_payment`, `mock_auth`, etc.)
- `stub_` prefix
- `pass  # placeholder`, `return None  # stub`

Always-excluded paths (never flagged as violations):
- `tests/`, `__mocks__/`, `__test__/`
- `*.test.py`, `*.spec.py`, `*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js`
