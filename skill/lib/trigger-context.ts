/**
 * trigger-context.ts
 *
 * Parses raw user input (natural-language phrase or slash-command) into a
 * `TriggerContext` per `specs/001-chiron-v1/contracts/skill-triggers.md`.
 *
 * The context feeds Stage 0 (Ingest) of the Chiron pipeline. Mode/domain may
 * be left as 'auto' here — final resolution happens later via the heuristic
 * in `mode-heuristic.ts` once source word count is known.
 *
 * v1 refuses German (`language-de`) explicitly; per skill-triggers.md
 * Validation #2 it must surface a "deferred to post-v1" error rather than
 * silently producing a broken lesson.
 */

// --- Public types ---------------------------------------------------------

export type TriggerSource = 'natural-language' | 'slash-command';
export type TriggerDomain =
  | 'code'
  | 'medicine'
  | 'language-it'
  | 'research-paper'
  | 'auto';
export type TriggerMode = 'A' | 'B' | 'auto';
export type ModeForcedBy = 'user-flag' | 'slash-command' | null;
export type TriggerSubMode = 'amboss' | 'uptodate';

export interface TriggerContext {
  raw: string;                   // original user text or slash-command + args
  source: TriggerSource;
  domain: TriggerDomain;
  mode: TriggerMode;
  modeForcedBy: ModeForcedBy;
  sourceArg: string | null;      // path / URL / inline content reference
  flags: { theme?: string; subMode?: TriggerSubMode };
}

// --- German-deferred refusal (FR-002 / spec.md) ---------------------------
// FR-002 / spec.md — German is post-v1; refused at the trigger boundary.

/**
 * Patterns covering every way a user might request German tutoring:
 *   - bare English word "german"
 *   - bare German word "deutsch"
 *   - the slug "language-de"
 *   - the slash-command "/chiron-language-de" at start of input
 *   - intent verbs ("teach", "tutor", "learn", "it") paired with "german"/"deutsch"
 */
const GERMAN_PATTERNS: RegExp[] = [
  /\bgerman\b/i,
  /\bdeutsch\b/i,
  /\blanguage-de\b/i,
  /^\/chiron-language-de\b/i,
  /\b(it|tutor|learn|teach)\b[\s\S]*\b(german|deutsch)\b/i,
];

/** Canonical message from skill/SKILL.md — keep verbatim. */
export const GERMAN_DEFERRED_MESSAGE =
  'Chiron v1 supports Italian only on the language axis. ' +
  'German tutoring is deferred to post-v1. ' +
  'The blockers are TTS-voice quality validation and the verb-conjugation-table widget, ' +
  'both planned for v1.1.';

/** Typed error so upstream callers can `instanceof`-discriminate this case. */
export class GermanDeferredError extends Error {
  readonly code = 'GERMAN_DEFERRED';
  constructor(message: string = GERMAN_DEFERRED_MESSAGE) {
    super(message);
    this.name = 'GermanDeferredError';
    // Preserve prototype chain when targeting older ES targets.
    Object.setPrototypeOf(this, GermanDeferredError.prototype);
  }
}

/**
 * Throws `GermanDeferredError` if `raw` requests German tutoring in any of
 * the supported forms. Called from both `parseTrigger` (initial trigger
 * boundary) and `applyModeOverride` (mid-conversation defense-in-depth).
 */
export function assertGermanNotRequested(raw: string): void {
  if (typeof raw !== 'string' || raw.length === 0) return;
  const trimmed = raw.trim();
  for (const re of GERMAN_PATTERNS) {
    if (re.test(trimmed)) {
      throw new GermanDeferredError();
    }
  }
}

// --- Constants ------------------------------------------------------------

interface SlashSpec {
  domain: TriggerDomain;
  mode: TriggerMode;
  modeForcedBy: ModeForcedBy;
}

const SLASH_TABLE: Record<string, SlashSpec> = {
  '/chiron':                 { domain: 'auto',           mode: 'auto', modeForcedBy: null },
  '/chiron-code':            { domain: 'code',           mode: 'A',    modeForcedBy: null },
  '/chiron-medicine':        { domain: 'medicine',       mode: 'A',    modeForcedBy: null },
  '/chiron-language':        { domain: 'language-it',    mode: 'A',    modeForcedBy: null },
  '/chiron-language-it':     { domain: 'language-it',    mode: 'A',    modeForcedBy: null },
  '/chiron-research-paper':  { domain: 'research-paper', mode: 'A',    modeForcedBy: null },
  '/chiron-case-study':      { domain: 'auto',           mode: 'B',    modeForcedBy: 'slash-command' },
};

const MODE_B_PHRASES = [
  /\bcase[-\s]?study this\b/i,
  /\bexplain the pattern\b/i,
  /\bmake (this|that) a teaching moment\b/i,
];

const MODE_A_PHRASES = [
  /\bteach me\b/i,
  /\bmake a course on\b/i,
  /\bmake a lesson out of\b/i,
  /\blesson from this pdf\b/i,
  /\bgenerate a course\b/i,
];

const CODE_FILE_EXT = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|cpp|c|h)\b/i;
const PATH_LIKE = /(?:^|\s)(\.{0,2}\/[\w./~-]+|~\/[\w./-]+|\/[\w./-]+)/;
const URL_LIKE = /\bhttps?:\/\/\S+/i;
const ARXIV_LIKE = /\barxiv\.org\b/i;

// Medical-vocabulary cue list — small, conservative. Real classification
// happens upstream of Stage 1; we only need enough to bias an auto-domain
// guess here.
const MEDICAL_TERMS = [
  'patient', 'diagnosis', 'pneumonia', 'sepsis', 'icd', 'usmle',
  'amboss', 'uptodate', 'clinical', 'differential', 'pathology',
  'hcc', 'raf', 'cardio', 'neuro', 'oncology',
];

// --- Public API -----------------------------------------------------------

export function parseTrigger(raw: string, source: TriggerSource): TriggerContext {
  if (typeof raw !== 'string') {
    throw new TypeError('parseTrigger: raw must be a string');
  }

  const trimmed = raw.trim();

  // Validation #2 — refuse German up-front (FR-002, before any other parsing).
  assertGermanNotRequested(trimmed);

  const flags = parseFlags(trimmed);

  if (source === 'slash-command') {
    return parseSlashCommand(trimmed, flags);
  }
  return parseNaturalLanguage(trimmed, flags);
}

// --- Slash-command path ---------------------------------------------------

function parseSlashCommand(
  raw: string,
  flags: TriggerContext['flags'],
): TriggerContext {
  const parts = raw.split(/\s+/);
  const head = (parts[0] ?? '').toLowerCase();
  const spec = SLASH_TABLE[head];
  if (!spec) {
    throw new Error(
      `Unknown slash-command "${head}". Known: ${Object.keys(SLASH_TABLE).join(', ')}`,
    );
  }

  // sourceArg: last non-flag arg, if any.
  const positional = parts.slice(1).filter((p) => p && !p.startsWith('--'));
  const sourceArg = positional.length > 0 ? positional[positional.length - 1]! : null;

  return {
    raw,
    source: 'slash-command',
    domain: spec.domain,
    mode: spec.mode,
    modeForcedBy: spec.modeForcedBy,
    sourceArg,
    flags,
  };
}

// --- Natural-language path ------------------------------------------------

function parseNaturalLanguage(
  raw: string,
  flags: TriggerContext['flags'],
): TriggerContext {
  let mode: TriggerMode = 'auto';
  let modeForcedBy: ModeForcedBy = null;

  if (MODE_B_PHRASES.some((re) => re.test(raw))) {
    mode = 'B';
    modeForcedBy = 'user-flag';
  } else if (MODE_A_PHRASES.some((re) => re.test(raw))) {
    mode = 'A';
  }

  const domain = inferDomain(raw);
  const sourceArg = extractSourceArg(raw);

  return {
    raw,
    source: 'natural-language',
    domain,
    mode,
    modeForcedBy,
    sourceArg,
    flags,
  };
}

// --- Helpers --------------------------------------------------------------

function inferDomain(raw: string): TriggerDomain {
  const lower = raw.toLowerCase();

  if (ARXIV_LIKE.test(raw) || /\bpaper\b/.test(lower)) {
    return 'research-paper';
  }

  if (
    /\brepo(sitory)?\b/.test(lower) ||
    /\bcodebase\b/.test(lower) ||
    CODE_FILE_EXT.test(raw)
  ) {
    return 'code';
  }

  const hasPdf = /\.pdf\b/i.test(raw);
  const hasMedTerm = MEDICAL_TERMS.some((t) => lower.includes(t));
  if (hasPdf && hasMedTerm) return 'medicine';
  if (hasMedTerm && !hasPdf) return 'medicine';

  if (/\bitalian\b/i.test(raw) || /\bvocab(ulary)?\b/i.test(raw)) {
    return 'language-it';
  }

  return 'auto';
}

function extractSourceArg(raw: string): string | null {
  const url = raw.match(URL_LIKE);
  if (url) return url[0];

  const path = raw.match(PATH_LIKE);
  if (path && path[1]) return path[1];

  return null;
}

// --- Mid-conversation mode override (FR-003) ------------------------------

/** FR-003 mid-conversation override per `contracts/skill-triggers.md`. */
export const MODE_OVERRIDE_PATTERNS: {
  mode: TriggerMode;
  patterns: RegExp[];
}[] = [
  {
    mode: 'A',
    patterns: [
      /\bswitch\s+to\s+mode\s+a\b/i,
      /\buse\s+mode\s+a\b/i,
      /\bmode\s+a\b/i,
    ],
  },
  {
    mode: 'B',
    patterns: [
      /\bswitch\s+to\s+mode\s+b\b/i,
      /\buse\s+mode\s+b\b/i,
      /\bmode\s+b\b/i,
      /\bcase[-\s]study\s+(this|it)\b/i,
    ],
  },
];

/**
 * applyModeOverride — FR-003 mid-conversation override.
 *
 * Pure function: scans `userMessage` for "mode a" / "mode b" override phrases
 * (case-insensitive, word-boundary anchored). If found, returns a new
 * TriggerContext with the updated mode + `modeForcedBy: 'user-flag'`.
 * If multiple override phrases appear, the LATER occurrence wins.
 * If no override phrase is present, returns `currentCtx` unchanged
 * (referentially equal — orchestrator can use `===` to detect no-op).
 */
export function applyModeOverride(
  currentCtx: TriggerContext,
  userMessage: string,
): TriggerContext {
  if (typeof userMessage !== 'string' || userMessage.length === 0) {
    return currentCtx;
  }

  // Defense-in-depth: catch a mid-conversation switch like
  // "actually let's do this in German". Throws GermanDeferredError.
  assertGermanNotRequested(userMessage);

  let bestIndex = -1;
  let bestMode: TriggerMode | null = null;

  // Find the LATEST match position across all patterns.
  for (const { mode, patterns } of MODE_OVERRIDE_PATTERNS) {
    for (const re of patterns) {
      // Use a fresh regex with the global flag stripped to ensure stateless matching.
      const match = userMessage.match(re);
      if (match && typeof match.index === 'number') {
        if (match.index > bestIndex) {
          bestIndex = match.index;
          bestMode = mode;
        }
      }
    }
  }

  if (bestMode === null) {
    return currentCtx;
  }

  return {
    ...currentCtx,
    mode: bestMode,
    modeForcedBy: 'user-flag',
  };
}

function parseFlags(raw: string): TriggerContext['flags'] {
  const flags: TriggerContext['flags'] = {};

  const themeMatch = raw.match(/--theme=([^\s]+)/i);
  if (themeMatch && themeMatch[1]) {
    flags.theme = themeMatch[1];
  }

  const subModeMatch = raw.match(/--submode=(amboss|uptodate)\b/i);
  if (subModeMatch && subModeMatch[1]) {
    flags.subMode = subModeMatch[1].toLowerCase() as TriggerSubMode;
  }

  return flags;
}
