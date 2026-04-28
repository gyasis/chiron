# Tech Context — Chiron

**Stack, dependencies, constraints, decisions.**

---

## Format & packaging

**Chiron is a Claude Code agent skill** (with possible MCP adjuncts for Anki integration).

```
~/.claude/skills/chiron/
├── SKILL.md                    # entry point — what triggers the skill, top-level workflow
├── prompts/                    # per-stage LLM prompt templates
├── concepts/                   # static concept DAGs per domain
├── curricula/                  # static curriculum templates per domain
├── personas/                   # peer-learner & expert persona templates
├── shell/                      # HTML rendering (forked codebase-to-course)
└── lib/                        # gateway, validator, anki client
```

Installation: symlink from `~/dev/projects/chiron/skill/` to `~/.claude/skills/chiron/` after build.

---

## Languages — pending debate

**TypeScript or Python — TBD.**

Arguments for **TypeScript**:
- ClassBuild + ai-course-generator + codebase-to-course are all TS — direct code-lift possible
- Same lang for backend + frontend (HTML output) = no FFI
- Anki MCP servers are mixed (TS and Python both available)

Arguments for **Python**:
- Faster prototyping for solo dev
- Better LLM-orchestration libraries (LiteLLM, Instructor, Pydantic AI)
- Anki MCP `amidvidy/anki-mcp` (the language-with-TTS one) is Python — easier integration
- Medical domain has more pre-built Python tooling (medspaCy, PyMedTermino)

Decision deferred to paired debate.

---

## Core dependencies (planned)

| Layer | Tool / library | Why |
|---|---|---|
| LLM provider — primary | Anthropic Claude (Opus/Sonnet/Haiku per task complexity) | Best instruction-following, agentic; aligns with Claude Code skill packaging |
| LLM provider — secondary | Google Gemini | TTS (Gemini speech), image gen (Gemini imagen), web-search grounding |
| LLM provider — fallback | OpenAI | If Anthropic rate-limits |
| HTML rendering shell | `codebase-to-course`'s `_base.html` + `styles.css` + `main.js` (forked) | ~85% domain-agnostic per audit |
| Mermaid diagrams | Mermaid.js (CDN) | For concept DAG visualization |
| Image gen | Gemini Imagen (or Anthropic image gen if available) | Infographics |
| TTS | Gemini TTS (`gemini-2.5-flash-preview-tts`) | German + Italian voices, peer voices |
| Anki integration | one of the Anki MCP servers (decision deferred) | **OPTIONAL one-way card export** (NOT the SR backend; see "Persistence pivot" below) |
| Persistence — runtime | SQLite (better-sqlite3 / sqlite3) | Per-learner state |
| Persistence — design | Markdown PRD + memory-bank | Cross-session context |
| Validation | Zod (TS) or Pydantic (Python) | Schema validation for LLM outputs |
| Caching | sha256 → SQLite | LLM-gateway request cache |
| Concept DAG storage | JSON files | Static, version-controlled |

---

## API keys required

| Provider | Why | Env var |
|---|---|---|
| Anthropic | Primary LLM | `ANTHROPIC_API_KEY` |
| Gemini | TTS, image gen, web-search | `GEMINI_API_KEY` |
| OpenAI | Fallback | `OPENAI_API_KEY` |
| Anki MCP server | SR backend (local — no API key, but AnkiConnect must be installed) | n/a (local Anki desktop required) |

**No proprietary medical APIs in v1.** No AMBOSS API access (paid, terms-of-service issues). No UpToDate API (Wolters Kluwer, paid). We replicate their *formatting style* via prompt engineering, never copy their content.

---

## Persistence pivot (2026-04-28)

**SQLite is the canonical persistence + SR layer**, not just an attempts log. The user explicitly wants:

- **Resume** — re-open a lesson, Chiron remembers exactly where you left off (last chapter, due flashcards, weakness log)
- **Revisit** — review past chapters, retake quizzes (with variant rotation), see due flashcards inline in the lesson HTML

Anki is **demoted to optional one-way export**. Some users may still want their cards in Anki for review on mobile / phone, so we'll generate `.apkg` files or push via MCP if requested — but the canonical SR scheduling and review experience lives in Chiron's HTML lesson, backed by SQLite.

This means we DO need to implement an SR scheduler (SM-2 is ~50 lines; FSRS is ~150 lines — both are well-documented algorithms). It does NOT mean reinventing Anki — it means owning the review experience end-to-end inside the lesson surface.

## Persistence schemas (draft)

### Runtime SQLite — `.chiron-state.db`

```sql
CREATE TABLE quiz_attempts (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    variant_id TEXT,            -- which question variant was shown
    selected_answer TEXT,
    correct INTEGER,            -- 0 or 1
    confidence INTEGER,         -- 1-5 if confidence-weighted
    timestamp INTEGER NOT NULL,
    UNIQUE(course_id, chapter_id, question_id, timestamp)
);

CREATE TABLE mastery (
    course_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    score REAL NOT NULL,        -- 0.0-1.0
    last_reviewed_at INTEGER,
    PRIMARY KEY (course_id, concept_id)
);

-- Spaced-repetition cards — Chiron owns SR, not Anki
CREATE TABLE sr_cards (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    concept_id TEXT,
    card_type TEXT NOT NULL,        -- 'cloze' | 'term-def' | 'vignette' | 'fill-blank' | etc.
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    -- SM-2 / FSRS state
    ease_factor REAL DEFAULT 2.5,   -- SM-2 EF
    interval_days INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_due_at INTEGER NOT NULL,
    last_reviewed_at INTEGER,
    suspended INTEGER DEFAULT 0
);

CREATE INDEX idx_sr_cards_due ON sr_cards(next_due_at) WHERE suspended = 0;

CREATE TABLE sr_review_log (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    rating INTEGER NOT NULL,        -- 1=again, 2=hard, 3=good, 4=easy (Anki convention)
    interval_days_after INTEGER,
    FOREIGN KEY (card_id) REFERENCES sr_cards(id)
);

CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    scroll_position REAL,           -- for resume
    last_visited_at INTEGER NOT NULL,
    note TEXT
);

CREATE TABLE chapter_completion (
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, chapter_id)
);

CREATE TABLE weakness_log (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    error_pattern TEXT,         -- e.g., "confused dative with accusative"
    timestamp INTEGER NOT NULL
);

CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    cache_hit INTEGER,
    request_hash TEXT NOT NULL,
    status TEXT,
    error TEXT
);

CREATE TABLE llm_cache (
    request_hash TEXT PRIMARY KEY,
    response_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

### Concept DAG — `concepts/<domain>.json`

```json
{
  "domain": "language-de",
  "version": "1.0.0",
  "concepts": {
    "noun-gender": {
      "title": "German Noun Gender",
      "prereqs": [],
      "summary": "Every German noun has one of three genders: der/die/das"
    },
    "definite-article": {
      "title": "Definite Articles",
      "prereqs": ["noun-gender"],
      "summary": "der/die/das change form by case"
    },
    "dative-case": {
      "title": "Dative Case",
      "prereqs": ["noun-gender", "definite-article"],
      "summary": "Used for indirect objects and after specific prepositions"
    }
  }
}
```

### Curriculum template — `curricula/<domain>.json`

```json
{
  "domain": "medicine-amboss",
  "version": "1.0.0",
  "section_template": [
    "Definition",
    "Etiology",
    "Pathophysiology",
    "Clinical features",
    "Diagnostics",
    "Treatment",
    "Complications",
    "Prognosis",
    "Differential diagnosis"
  ],
  "required_quizzes_per_section": {
    "type": "mcq-clinical-vignette",
    "min_count": 2,
    "max_count": 4
  },
  "high_yield_callout_format": "AMBOSS Hammer Card",
  "tooltip_definitions": true
}
```

### Persona template — `personas/<domain>.json`

```json
{
  "domain": "medicine",
  "expert_persona": {
    "name": "Dr. Reyes",
    "role": "attending physician, internal medicine",
    "voice_style": "Socratic, patient, asks 'what else?' rather than telling",
    "voice_id": "anthropic_voice_3"
  },
  "peer_personas": [
    {
      "name": "Mike",
      "role": "third-year medical student",
      "voice_style": "earnest, sometimes overconfident, wrong about ~30% of plausible-but-wrong things"
    },
    {
      "name": "Priya",
      "role": "internal medicine resident",
      "voice_style": "asks deeper why-questions, references guidelines"
    }
  ]
}
```

---

## Browser compatibility

HTML output must run in:
- ✅ Latest Chrome / Firefox / Safari / Edge
- ✅ With JavaScript enabled (vanilla, no framework)
- ✅ Without external network calls **except**: Google Fonts CDN (already in codebase-to-course; can be self-hosted), Mermaid.js CDN (for diagrams), nothing else
- ❌ No service workers, no fetch to non-localhost
- ❌ No build step required — open `index.html` directly

---

## Performance budgets

| Metric | Budget |
|---|---|
| Lesson generation time | < 5 min (target), < 10 min (acceptable) per typical course |
| HTML output size (single course) | < 2 MB total (HTML + CSS + JS + inline images) |
| Time to interactive (browser) | < 1 sec on typical hardware |
| Anki deck export | < 30 sec for ~100 cards |

---

## Cost budget

Per-course generation (rough estimate):
- ~20-30 LLM calls (curriculum + per-chapter content + quizzes + personas + cards)
- Mostly Sonnet, occasional Opus for syllabus, Haiku for answer-balancing
- Image gen: 5-10 Gemini Imagen calls per course
- TTS: language-domain only — 5-10 minutes audio per chapter
- **Target: < $5 per course generation** (typical course)
- **Budget guard: hard fail at $25 per course** (anything above suggests runaway loop)
