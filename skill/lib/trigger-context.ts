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

// --- Constants ------------------------------------------------------------

const GERMAN_PATTERN = /(\bgerman\b|\bdeutsch\b|language-de|\/chiron-language-de)/i;

const GERMAN_REFUSAL_MESSAGE =
  'German (language-de) is deferred to post-v1. ' +
  'Chiron v1 supports Italian only for the language domain. ' +
  'Re-issue without the German request, or pick another domain.';

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

  // Validation #2 — refuse German up-front (covers both styles).
  if (GERMAN_PATTERN.test(trimmed)) {
    throw new Error(GERMAN_REFUSAL_MESSAGE);
  }

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
