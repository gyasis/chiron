# Chiron Research Folder

This folder is the **canonical record of every input that informed Chiron's design**. The conclusions live in `~/dev/projects/chiron/memory-bank/` and the design PRD; the raw inputs live here.

If a future session (or future Gyasi) asks "why did we decide X?", the answer should be derivable from these artifacts.

---

## Contents (chronological)

### Deep research outputs

| # | File | Topic | Date | Source | Size |
|---|---|---|---|---|---|
| 01 | [`2026-04/01_deep_research_broad_market_scan_*.md`](2026-04/) | LLM lesson generators, MCP edu, agent-skill packs across all domains (medical / language / code / etc.) | 2026-04-28 | Gemini Deep Research (task `a24b55d0`, 26.7 min) | ~36KB |
| 02 | [`2026-04/02_deep_research_amboss_uptodate_medical_formatting_*.md`](2026-04/) | AMBOSS + UpToDate structural / pedagogical formatting analysis with replication-ready prompt scaffolds | 2026-04-28 | Gemini Deep Research (task `aa71eb17`, 21.2 min) | ~41KB |

### Reference repo audits

| # | File | Repo | Verdict | Audited at |
|---|---|---|---|---|
| 03 | [`03_audit_codebase_to_course.md`](03_audit_codebase_to_course.md) | [zarazhangrui/codebase-to-course](https://github.com/zarazhangrui/codebase-to-course) (4.1k★, MIT) | ✅ SAFE — fork as HTML rendering shell | `~/dev/audits/codebase-to-course/` |
| 04 | [`04_audit_classbuild.md`](04_audit_classbuild.md) | [jtangen/classbuild](https://github.com/jtangen/classbuild) (MIT) | ✅ SAFE — adopt typed-schema-pedagogy + 7-question challenge + answer-balancer + theme parameterization | `~/dev/audits/classbuild/` |
| 05 | [`05_audit_ai_course_generator.md`](05_audit_ai_course_generator.md) | [JulienAvezou/ai-course-generator](https://github.com/JulienAvezou/ai-course-generator) (MIT) | ✅ SAFE — adopt concept-DAG-as-validator + LLM-as-advisor pattern + LLM-output-validation retry loop | `~/dev/audits/ai-course-generator/` |

### Design synthesis

| # | File | Topic | Format |
|---|---|---|---|
| 06 | [`06_paired_debate_2026-04-28.md`](06_paired_debate_2026-04-28.md) | **THE architectural debate** — Round 1 (Hawk) + Round 2 (Pragmatist) + Act III (Synthesis with 12 locked decisions) | Claude × Gemini paired debate, written 2026-04-28 |

---

## How decisions traced from research to design

```
┌─────────────────────────┐         ┌──────────────────────────┐         ┌─────────────────────────┐
│ Deep research (01)       │   →    │ Reference repo audits     │   →    │ Paired debate (06)       │
│ Discovers candidate repos│         │ (03, 04, 05)              │         │ Synthesizes inputs       │
└─────────────────────────┘         └──────────────────────────┘         └─────────────────────────┘
                                                                                       │
                                                                                       ▼
┌──────────────────────────┐                                            ┌───────────────────────────┐
│ Deep research (02)        │   ────────────────────────→               │ Memory-bank + PRD          │
│ AMBOSS/UpToDate templates │                                            │ Final design captured      │
└──────────────────────────┘                                            └───────────────────────────┘
```

Each Chiron architectural decision should be traceable through this chain. If you find a decision in `memory-bank/systemPatterns.md` whose rationale isn't grounded in something here, that's a smell — capture the missing rationale before locking.

---

## When to add to this folder

Add new research artifacts when:
- A new deep-research call completes (use `mcp__gemini-mcp__save_research_to_markdown` — it auto-organizes by month)
- A new repo is audited (write a fresh `0N_audit_<repo>.md` following the same template as 03/04/05)
- A new paired debate runs (one file per debate, dated)
- A new architectural decision is made that's NOT derivable from existing research (capture the rationale immediately)

**Do NOT add:**
- Source code clones (those live in `~/dev/audits/<repo>/`, separately)
- Memory-bank state (that's `memory-bank/`)
- The PRD itself (that's `prd/`)
- Runtime learner state (that's per-lesson `<lesson-dir>/.chiron-state.db`)

---

## Folder map (parent project)

```
~/dev/projects/chiron/
├── README.md
├── CLAUDE.md
├── .gitignore
├── memory-bank/             ← navigation index for future sessions
├── prd/                     ← design PRDs (tracking + comprehensive)
└── research/                ← THIS FOLDER — raw inputs to design decisions
    ├── README.md
    ├── 2026-04/
    │   ├── 01_deep_research_broad_market_scan_*.md
    │   └── 02_deep_research_amboss_uptodate_medical_formatting_*.md
    ├── 03_audit_codebase_to_course.md
    ├── 04_audit_classbuild.md
    ├── 05_audit_ai_course_generator.md
    └── 06_paired_debate_2026-04-28.md
```
