// Stage 0 INGEST adapter — transcript (FR-032 h)
//
// Handles plain text / markdown chat-meeting-lecture transcripts. Detects the
// dominant speaker pattern (slack / markdown-chat / meeting / lecture-monolog),
// normalizes turns to `Speaker: line`, copies the source file into
// `<lessonOutputDir>/source/` per FR-030, and produces a `Brief` with
// `sourceType: 'transcript'`.
//
// This adapter MUST NOT call any LLM (Stage 0 is deterministic).

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';

import type { Brief } from '../lib/schemas/brief.js';
import { copySources } from '../lib/source-copy.js';
import { stage } from '../lib/progress.js';

export type TranscriptPattern =
  | 'slack'
  | 'meeting'
  | 'markdown-chat'
  | 'lecture-monolog'
  | 'unknown';

export interface IngestTranscriptOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  domain: 'code' | 'medicine' | 'language-it' | 'research-paper';
}

interface DetectionResult {
  pattern: TranscriptPattern;
  turns: Array<{ speaker: string | null; text: string }>;
  speakers: string[];
}

// ---------- Markdown cleaning ----------

// Strip emphasis markers (**bold**, *italic*, _underline_, `code`, ~~strike~~)
// while preserving the inner text. Keep heading text (drop leading `#`s).
// Drop code-fence delimiters (``` or ~~~) but keep the lines inside them.
function cleanMarkdownLine(line: string): string {
  let out = line;
  // Heading: strip leading hashes + space.
  out = out.replace(/^\s{0,3}#{1,6}\s+/, '');
  // Bold + italic combinations — order matters: longest first.
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  out = out.replace(/___([^_]+)___/g, '$1');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');
  return out;
}

function isCodeFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

// ---------- Pattern detection ----------

// Slack-style: `**Alice** at 10:30 AM` followed by message line(s).
// We capture the bolded name and treat subsequent non-empty, non-header lines
// as that speaker's turn until the next speaker header.
const SLACK_HEADER_RE = /^\s*\*\*([^*\n]+?)\*\*(?:\s+at\s+[^\n]*)?\s*$/;

// Markdown chat: `### Alice` (h3 with just a name) followed by message lines.
const MD_CHAT_HEADER_RE = /^\s{0,3}#{1,6}\s+([^\s#].{0,80}?)\s*$/;

// Meeting notes: `Alice: message here` on the same line.
// Restrict speaker to <=40 chars of letters, digits, spaces, dots, hyphens, apostrophes.
const MEETING_LINE_RE = /^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'\-]{0,39}?)\s*:\s+(.*\S.*)$/;

function looksLikeNameOnly(s: string): boolean {
  // Reject if it contains punctuation suggesting a sentence/heading rather than a name.
  if (s.length === 0 || s.length > 60) return false;
  if (/[.!?]/.test(s)) return false;
  if (/^\d/.test(s)) return false;
  // Must contain at least one letter.
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
  // Disallow markdown link / image syntax.
  if (/[\[\]\(\)]/.test(s)) return false;
  return true;
}

function detectSlack(lines: string[]): DetectionResult {
  const turns: Array<{ speaker: string | null; text: string }> = [];
  const speakers: string[] = [];
  let current: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (current !== null && buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text.length > 0) turns.push({ speaker: current, text });
    }
    buffer = [];
  };

  for (const raw of lines) {
    if (isCodeFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buffer.push(raw);
      continue;
    }
    const m = SLACK_HEADER_RE.exec(raw);
    if (m && looksLikeNameOnly(m[1]!.trim())) {
      flush();
      current = m[1]!.trim();
      if (!speakers.includes(current)) speakers.push(current);
    } else {
      buffer.push(cleanMarkdownLine(raw));
    }
  }
  flush();
  return { pattern: 'slack', turns, speakers };
}

function detectMarkdownChat(lines: string[]): DetectionResult {
  const turns: Array<{ speaker: string | null; text: string }> = [];
  const speakers: string[] = [];
  let current: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (current !== null && buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text.length > 0) turns.push({ speaker: current, text });
    }
    buffer = [];
  };

  for (const raw of lines) {
    if (isCodeFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buffer.push(raw);
      continue;
    }
    const m = MD_CHAT_HEADER_RE.exec(raw);
    if (m && looksLikeNameOnly(m[1]!.trim())) {
      flush();
      current = m[1]!.trim();
      if (!speakers.includes(current)) speakers.push(current);
    } else {
      buffer.push(cleanMarkdownLine(raw));
    }
  }
  flush();
  return { pattern: 'markdown-chat', turns, speakers };
}

function detectMeeting(lines: string[]): DetectionResult {
  const turns: Array<{ speaker: string | null; text: string }> = [];
  const speakers: string[] = [];
  let inFence = false;
  let lastSpeaker: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (lastSpeaker !== null && buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text.length > 0) turns.push({ speaker: lastSpeaker, text });
    }
    buffer = [];
  };

  for (const raw of lines) {
    if (isCodeFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buffer.push(raw);
      continue;
    }
    const m = MEETING_LINE_RE.exec(raw);
    if (m && looksLikeNameOnly(m[1]!.trim())) {
      flush();
      lastSpeaker = m[1]!.trim();
      if (!speakers.includes(lastSpeaker)) speakers.push(lastSpeaker);
      buffer.push(cleanMarkdownLine(m[2]!));
    } else {
      buffer.push(cleanMarkdownLine(raw));
    }
  }
  flush();
  return { pattern: 'meeting', turns, speakers };
}

function detectLectureMonolog(lines: string[]): DetectionResult {
  const cleaned: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    if (isCodeFence(raw)) {
      inFence = !inFence;
      continue;
    }
    cleaned.push(inFence ? raw : cleanMarkdownLine(raw));
  }
  const text = cleaned.join('\n').trim();
  return {
    pattern: 'lecture-monolog',
    turns: text.length > 0 ? [{ speaker: null, text }] : [],
    speakers: [],
  };
}

// Score each candidate by how many lines its pattern matches.
function scorePattern(lines: string[]): TranscriptPattern {
  let slack = 0;
  let mdChat = 0;
  let meeting = 0;
  let inFence = false;
  for (const raw of lines) {
    if (isCodeFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (SLACK_HEADER_RE.test(raw)) {
      const m = SLACK_HEADER_RE.exec(raw);
      if (m && looksLikeNameOnly(m[1]!.trim())) slack++;
    }
    const mdM = MD_CHAT_HEADER_RE.exec(raw);
    if (mdM && looksLikeNameOnly(mdM[1]!.trim())) mdChat++;
    const meetM = MEETING_LINE_RE.exec(raw);
    if (meetM && looksLikeNameOnly(meetM[1]!.trim())) meeting++;
  }
  // Require at least 2 distinct hits before claiming a pattern (avoids
  // single-stray-colon false positives in lecture transcripts).
  const best = Math.max(slack, mdChat, meeting);
  if (best < 2) return 'lecture-monolog';
  if (slack === best) return 'slack';
  if (mdChat === best) return 'markdown-chat';
  if (meeting === best) return 'meeting';
  return 'unknown';
}

function detect(text: string): DetectionResult {
  const lines = text.split(/\r?\n/);
  const pattern = scorePattern(lines);
  switch (pattern) {
    case 'slack':
      return detectSlack(lines);
    case 'markdown-chat':
      return detectMarkdownChat(lines);
    case 'meeting':
      return detectMeeting(lines);
    case 'lecture-monolog':
    case 'unknown':
    default:
      return detectLectureMonolog(lines);
  }
}

// ---------- Public API ----------

export async function ingestTranscript(
  opts: IngestTranscriptOptions,
): Promise<Brief> {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestTranscript: sourcePath does not exist: ${absInput}`);
  }
  const st = statSync(absInput);
  if (!st.isFile()) {
    throw new Error(`ingestTranscript: sourcePath is not a file: ${absInput}`);
  }

  const ext = extname(absInput).toLowerCase();
  let format: 'plain' | 'markdown';
  if (ext === '.md') {
    format = 'markdown';
  } else if (ext === '.txt') {
    format = 'plain';
  } else {
    throw new Error(
      `ingestTranscript: unsupported extension '${ext}' for ${basename(absInput)} ` +
        `(expected .md or .txt)`,
    );
  }

  const raw = readFileSync(absInput, 'utf8');
  if (raw.trim().length === 0) {
    throw new Error(`ingestTranscript: file is empty: ${absInput}`);
  }

  const detection = detect(raw);

  // Build extractedText preserving turns as `Speaker: line` (or just the
  // text for monolog / unknown).
  const extractedText = detection.turns
    .map((t) => {
      if (t.speaker === null) return t.text;
      // For multi-line turns, prefix each line so context is preserved.
      return t.text
        .split('\n')
        .map((l) => `${t.speaker}: ${l}`)
        .join('\n');
    })
    .join('\n')
    .trim();

  // FR-030: copy source into <lessonOutputDir>/source/.
  const copied = await copySources(
    [{ path: absInput, kind: 'transcript' }],
    `${opts.lessonOutputDir}/source`,
  );
  const sourceCopiedTo = copied[0]?.copiedPath ?? null;

  const lineCount = raw.split(/\r?\n/).length;
  const wordCount = extractedText.length === 0
    ? 0
    : extractedText.split(/\s+/).filter((w) => w.length > 0).length;
  const speakerCount = detection.speakers.length;

  stage(
    0,
    5,
    `ingest: transcript (${speakerCount} speakers, ${wordCount} words)`,
  );

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType: 'transcript',
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText,
    metadata: {
      wordCount,
      lineCount,
      speakers: detection.speakers,
      speakerCount,
      format,
      detectedPattern: detection.pattern,
    },
    briefSchemaVersion: '1',
  };

  return brief;
}
