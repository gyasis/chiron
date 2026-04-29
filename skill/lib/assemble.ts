/**
 * Chiron — Stage 5 ASSEMBLE orchestrator (T033).
 *
 * Per `specs/001-chiron-v1/contracts/pipeline-stages.md` Stage 5:
 *   1. Invoke `skill/shell/build.sh <lessonOutputDir>` to inline vendored libs
 *      into a single self-contained `lesson.html` (FR-037 / Q9).
 *   2. Initialize `<lessonOutputDir>/.chiron-state.db` via `sqlite-init.ts`
 *      (8 tables, no `llm_usage` / `llm_cache` per Q8).
 *   3. Seed `sr_cards` with chapter-1 cards due-now (SM-2 initial state:
 *      ease_factor=2.5, interval_days=0, repetitions=0, next_due_at=now).
 *   4. Seed `bookmarks` with chapter-1 entry (scroll_position=0).
 *   5. Open `lesson.html` in the user's default browser via the
 *      platform-native opener (`xdg-open` / `open` / `start`), detached
 *      and unref'd so the orchestrator does not block.
 *
 * Progress is emitted to stderr with the `[stage 5/5]` prefix (FR-028).
 *
 * NOTE on schema field names: the canonical schema (`sqlite-schema.sql`)
 * uses `course_id` + `chapter_id` (TEXT) on `sr_cards` and `bookmarks`,
 * NOT a `chapter_number` integer. We therefore key chapter 1 as the string
 * `'1'`. The course id is derived from the lesson directory's basename.
 */

import { execFileSync, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

import { initDb } from './sqlite-init.js';

/** A chapter-1 SR card seeded at lesson assembly time. */
export interface Chapter1SrCard {
  /** Front-of-card prompt (term, cloze, question stem, vignette, ...). */
  front: string;
  /** Back-of-card answer / explanation. */
  back: string;
  /** Optional tags — JSON-encoded into the schema's `sr_cards.tags` TEXT column. */
  tags?: string[];
  /**
   * Card type — `'cloze' | 'term-def' | 'vignette' | 'fill-blank' | ...`.
   * Defaults to `'term-def'` if omitted.
   */
  card_type?: string;
  /** Optional concept id linking this card to a concept node. */
  concept_id?: string;
}

/** Inputs to {@link assembleLesson}. */
export interface AssembleOptions {
  /** Output directory where `lesson.html` and `.chiron-state.db` live. */
  lessonOutputDir: string;
  /** Path to the `skill/` directory that contains `shell/build.sh`. */
  skillRoot: string;
  /** Cards to seed into `sr_cards` for chapter 1, all due-now. */
  chapter1SrCards: Chapter1SrCard[];
}

/** Result of {@link assembleLesson}. */
export interface AssembleResult {
  /** Absolute path to the assembled `lesson.html`. */
  lessonHtmlPath: string;
  /** Absolute path to the initialized SQLite DB. */
  dbPath: string;
}

/** Emit a `[stage 5/5]` progress line to stderr. */
function progress(msg: string): void {
  process.stderr.write(`[stage 5/5] ${msg}\n`);
}

/**
 * Stage 5 orchestrator. Synchronous: build, init DB, seed, then fire-and-forget
 * the browser open. Throws on any sub-step failure.
 */
export function assembleLesson(opts: AssembleOptions): AssembleResult {
  const lessonOutputDir = resolve(opts.lessonOutputDir);
  const skillRoot = resolve(opts.skillRoot);
  const buildScript = join(skillRoot, 'shell', 'build.sh');

  if (!existsSync(buildScript)) {
    throw new Error(`assembleLesson: build.sh not found at ${buildScript}`);
  }

  // ---- Step 1: build.sh inlines vendored libs --------------------------------
  progress(`assemble: running build.sh -> ${lessonOutputDir}`);
  execFileSync(buildScript, [lessonOutputDir], {
    stdio: 'inherit',
  });

  const lessonHtmlPath = join(lessonOutputDir, 'lesson.html');
  if (!existsSync(lessonHtmlPath) || statSync(lessonHtmlPath).size === 0) {
    throw new Error(
      `assembleLesson: build.sh did not produce a non-empty lesson.html at ${lessonHtmlPath}`,
    );
  }

  // ---- Step 2: initialize SQLite ---------------------------------------------
  progress('assemble: initializing .chiron-state.db');
  const db = initDb(lessonOutputDir);
  const dbPath = join(lessonOutputDir, '.chiron-state.db');

  // The lesson directory's basename is a stable, human-readable course id.
  const courseId = basename(lessonOutputDir);
  const chapterOneId = '1';
  const now = Date.now();

  try {
    // ---- Step 3: seed sr_cards (chapter 1, all due now) ----------------------
    const insertCard = db.prepare(
      `INSERT INTO sr_cards (
         course_id, chapter_id, concept_id, card_type, front, back, tags,
         ease_factor, interval_days, repetitions, next_due_at, suspended
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 2.5, 0, 0, ?, 0)`,
    );

    const seedCards = db.transaction((cards: Chapter1SrCard[]) => {
      for (const c of cards) {
        insertCard.run(
          courseId,
          chapterOneId,
          c.concept_id ?? null,
          c.card_type ?? 'term-def',
          c.front,
          c.back,
          c.tags && c.tags.length > 0 ? JSON.stringify(c.tags) : null,
          now,
        );
      }
    });
    seedCards(opts.chapter1SrCards);
    progress(
      `assemble: seeded ${opts.chapter1SrCards.length} sr_cards for chapter ${chapterOneId} (due now)`,
    );

    // ---- Step 4: seed bookmark for chapter 1 ---------------------------------
    db.prepare(
      `INSERT INTO bookmarks (course_id, chapter_id, scroll_position, last_visited_at, note)
       VALUES (?, ?, 0, ?, NULL)`,
    ).run(courseId, chapterOneId, now);
    progress(`assemble: seeded bookmark at chapter ${chapterOneId}`);
  } finally {
    db.close();
  }

  // ---- Step 5: open lesson.html in default browser (detached) ---------------
  openInBrowser(lessonHtmlPath);
  progress(`assemble: lesson.html written, opening in browser`);

  return { lessonHtmlPath, dbPath };
}

/**
 * Spawn the platform-native opener for `filePath` detached so it does not
 * block the orchestrator. Failure here is non-fatal — the caller already has
 * a valid path and DB.
 */
function openInBrowser(filePath: string): void {
  const plat = platform();
  let cmd: string;
  let args: string[];

  if (plat === 'darwin') {
    cmd = 'open';
    args = [filePath];
  } else if (plat === 'win32') {
    // `start` is a cmd.exe builtin; the empty "" is the window title slot.
    cmd = 'cmd';
    args = ['/c', 'start', '""', filePath];
  } else {
    cmd = 'xdg-open';
    args = [filePath];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    // Non-fatal: the lesson is already on disk; user can open it manually.
    process.stderr.write(
      `[stage 5/5] assemble: warning — failed to auto-open browser (${(err as Error).message}); open ${filePath} manually\n`,
    );
  }
}
