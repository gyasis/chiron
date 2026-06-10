-- Chiron v1 — SQLite schema
-- Lives at: <lesson-output-dir>/.chiron-state.db
-- Per-lesson, single learner. Mirrors PRD §8 verbatim plus _chiron_meta for migrations (R-08).
-- Bound to: FR-010, FR-011, FR-013, FR-014, FR-021.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ----------------------------------------------------------------------------
-- Schema versioning (R-08 — forward-only idempotent migrations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _chiron_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO _chiron_meta (key, value) VALUES ('schema_version', '1');

-- ----------------------------------------------------------------------------
-- Quiz attempts (full history for review + analytics) — FR-013
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id              INTEGER PRIMARY KEY,
    course_id       TEXT NOT NULL,
    chapter_id      TEXT NOT NULL,
    question_id     TEXT NOT NULL,
    variant_id      TEXT,                       -- which FR-021 variant was rendered
    selected_answer TEXT,
    correct         INTEGER,                    -- 0/1
    confidence      INTEGER,                    -- for confidence-weighted widgets
    timestamp       INTEGER NOT NULL,           -- unix ms
    UNIQUE(course_id, chapter_id, question_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_course_chapter
    ON quiz_attempts(course_id, chapter_id);

-- ----------------------------------------------------------------------------
-- Numeric mastery per concept (decay-aware) — FR-013
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mastery (
    course_id        TEXT NOT NULL,
    concept_id       TEXT NOT NULL,
    score            REAL NOT NULL,             -- 0.0..1.0
    last_reviewed_at INTEGER,                   -- unix ms
    PRIMARY KEY (course_id, concept_id)
);

-- ----------------------------------------------------------------------------
-- Chapter completion (drives resume) — FR-013
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapter_completion (
    course_id    TEXT NOT NULL,
    chapter_id   TEXT NOT NULL,
    completed_at INTEGER NOT NULL,              -- unix ms
    PRIMARY KEY (course_id, chapter_id)
);

-- ----------------------------------------------------------------------------
-- Weakness log (drives interleaving + next-chapter pseudo-state) — FR-023
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weakness_log (
    id            INTEGER PRIMARY KEY,
    course_id     TEXT NOT NULL,
    concept_id    TEXT NOT NULL,
    error_pattern TEXT,                         -- freeform tag from validator
    timestamp     INTEGER NOT NULL              -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_weakness_log_course_concept
    ON weakness_log(course_id, concept_id);

-- ----------------------------------------------------------------------------
-- (llm_usage and llm_cache tables REMOVED by Clarification Q8 — Chiron is
--  skill-driven; no in-tree LLM gateway, no in-tree call log, no sha256 cache.)
-- ----------------------------------------------------------------------------
-- Spaced-repetition cards (Chiron owns SR — FR-011, R-07 SM-2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sr_cards (
    id               INTEGER PRIMARY KEY,
    course_id        TEXT NOT NULL,
    chapter_id       TEXT NOT NULL,
    concept_id       TEXT,
    card_type        TEXT NOT NULL,             -- 'cloze' | 'term-def' | 'vignette' | 'fill-blank' | ...
    front            TEXT NOT NULL,
    back             TEXT NOT NULL,
    tags             TEXT,                      -- nullable; JSON-encoded string[] from Stage 4n
    -- SM-2 state
    ease_factor      REAL    DEFAULT 2.5,
    interval_days    INTEGER DEFAULT 0,
    repetitions      INTEGER DEFAULT 0,
    next_due_at      INTEGER NOT NULL,          -- unix ms
    last_reviewed_at INTEGER,
    suspended        INTEGER DEFAULT 0
);

-- Hot path: "what's due right now?" lookup on lesson re-open (SC-006)
CREATE INDEX IF NOT EXISTS idx_sr_cards_due
    ON sr_cards(next_due_at) WHERE suspended = 0;

-- ----------------------------------------------------------------------------
-- SR review log — FR-011
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sr_review_log (
    id                  INTEGER PRIMARY KEY,
    card_id             INTEGER NOT NULL,
    reviewed_at         INTEGER NOT NULL,       -- unix ms
    rating              INTEGER NOT NULL,       -- 1=again, 2=hard, 3=good, 4=easy
    interval_days_after INTEGER,
    FOREIGN KEY (card_id) REFERENCES sr_cards(id)
);

-- ----------------------------------------------------------------------------
-- Bookmarks (resume + scroll-position restore) — FR-013
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookmarks (
    id              INTEGER PRIMARY KEY,
    course_id       TEXT NOT NULL,
    chapter_id      TEXT NOT NULL,
    scroll_position REAL,                       -- 0.0..1.0 within chapter
    last_visited_at INTEGER NOT NULL,
    note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_course_chapter
    ON bookmarks(course_id, chapter_id);

-- ----------------------------------------------------------------------------
-- Audio lecture clips — "Listen mode" bake manifest + audit log (additive, v1.1)
-- Written by lib/audio-bake.ts AFTER Stage 5 assemble. Deterministic bake — no
-- LLM, no SDK (Q8-safe; the lecture *script* is authored upstream by Gemini).
-- `script_hash` keys reuse: an unchanged lecture script re-uses its existing
-- mp3 instead of re-synthesizing (economy-first). `status`/`error` make the
-- async bake observable + pollable (PRD §7).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audio_clips (
    id            INTEGER PRIMARY KEY,
    course_id     TEXT NOT NULL,
    artifact      TEXT NOT NULL,                  -- 'summary' | 'shortened' | 'section'
    section_id    TEXT NOT NULL DEFAULT '',       -- DOM anchor for 'section'; '' for whole-lesson artifacts
    voice         TEXT NOT NULL,                  -- 'pauls_tutor' | 'lucrezia_english' | 'lucrezia_italian' | 'mixed'
    lang          TEXT,                           -- 'en' | 'it' | 'mixed'
    script_hash   TEXT NOT NULL,                  -- sha256 of the segment script → reuse key
    segments_json TEXT,                           -- language-tagged segment list (transcript + re-bake source)
    audio_path    TEXT,                           -- relative: audio/<artifact>[/section/<section_id>].mp3
    duration_s    REAL,
    bytes         INTEGER,
    lufs          REAL,                           -- measured integrated loudness (target -30)
    status        TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'baking' | 'done' | 'failed'
    error         TEXT,                           -- actionable message when status='failed'
    reuse_count   INTEGER NOT NULL DEFAULT 0,
    generated_at  INTEGER,                        -- unix ms
    UNIQUE(course_id, artifact, section_id)
);

-- Hot path: "what's pending / done / failed?" poll while the async bake runs
CREATE INDEX IF NOT EXISTS idx_audio_clips_status
    ON audio_clips(course_id, status);
