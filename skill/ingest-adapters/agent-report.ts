// Stage 0 INGEST adapter — agent-report (FR-032 k).
//
// Accepts markdown / JSON / plain-text output produced by another AI agent
// (Claude, Gemini, etc.) as a *secondary* source for a Chiron lesson. The
// entry is marked `agent-report` in `Brief.sourceManifest[]` (the schema's
// secondary marker per FR-034) and `Brief.agentSourceProvenance` records who
// produced it.
//
// FR-035 / SC-016: medicine refuses agent-report as the SOLE source. If
// `domain === 'medicine'` and `isPartOfBundle !== true`, this adapter throws
// rather than emit a Brief. When part of a bundle (T076) the bundle adapter
// is responsible for ensuring at least one primary medical source exists.
//
// This adapter MUST NOT call any LLM (Stage 0 is deterministic).

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';

import type { Brief, SourceFileEntry } from '../lib/schemas/brief.js';
import { copySources } from '../lib/source-copy.js';
import { stage } from '../lib/progress.js';

export interface IngestAgentReportOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
  domain: 'code' | 'medicine' | 'language-it' | 'research-paper';
  /**
   * When true, this agent-report is one of several sources in a bundle
   * (FR-032 l) — the medicine SOLE-source guard is relaxed because the
   * bundle adapter (T076) is responsible for ensuring a primary clinical
   * source is present alongside.
   */
  isPartOfBundle?: boolean;
}

// ---------- Format detection / text extraction ----------

type AgentReportFormat = 'json' | 'markdown' | 'plain';

function detectFormat(absPath: string, raw: string): AgentReportFormat {
  const ext = extname(absPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'plain';
  // Content sniff fallback for unusual extensions.
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^---\s*$/m.test(raw.split('\n').slice(0, 20).join('\n'))) return 'markdown';
  return 'plain';
}

interface JsonExtraction {
  text: string;
  /** Best-effort agent provenance hint pulled from the JSON body. */
  provenance: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Common message-like array shape, e.g. `[{ role, content }, ...]`.
function looksLikeMessageArray(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  let hits = 0;
  for (const item of arr) {
    if (!isPlainObject(item)) continue;
    if ('content' in item || 'text' in item || 'body' in item || 'message' in item) {
      hits++;
    }
  }
  return hits >= Math.min(2, arr.length);
}

function extractMessageText(item: Record<string, unknown>): string {
  // Try the usual fields, in priority order.
  for (const k of ['content', 'text', 'body', 'message']) {
    const v = item[k];
    if (typeof v === 'string') return v;
    // Anthropic-style content arrays: `[{ type: 'text', text: '...' }, ...]`
    if (Array.isArray(v)) {
      const parts: string[] = [];
      for (const part of v) {
        if (typeof part === 'string') {
          parts.push(part);
        } else if (isPlainObject(part) && typeof part['text'] === 'string') {
          parts.push(part['text'] as string);
        }
      }
      if (parts.length > 0) return parts.join('\n');
    }
  }
  return '';
}

function extractFromJson(raw: string): JsonExtraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ingestAgentReport: invalid JSON: ${msg}`);
  }

  let provenance: string | null = null;
  const captureProvenance = (obj: Record<string, unknown>): void => {
    if (provenance !== null) return;
    for (const k of ['agent', 'model', 'producer', 'tool']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim().length > 0) {
        provenance = v.trim();
        return;
      }
    }
  };

  if (Array.isArray(parsed)) {
    if (looksLikeMessageArray(parsed)) {
      const parts: string[] = [];
      for (const item of parsed) {
        if (!isPlainObject(item)) continue;
        captureProvenance(item);
        const speaker =
          typeof item['role'] === 'string'
            ? (item['role'] as string)
            : typeof item['speaker'] === 'string'
              ? (item['speaker'] as string)
              : null;
        const body = extractMessageText(item);
        if (body.length === 0) continue;
        parts.push(speaker ? `${speaker}: ${body}` : body);
      }
      return { text: parts.join('\n\n').trim(), provenance };
    }
    // Generic array: stringify each text-like element.
    const parts: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') parts.push(item);
      else if (isPlainObject(item)) {
        captureProvenance(item);
        const t = extractMessageText(item);
        if (t.length > 0) parts.push(t);
      }
    }
    return { text: parts.join('\n\n').trim(), provenance };
  }

  if (isPlainObject(parsed)) {
    captureProvenance(parsed);
    // Direct text-bearing fields first.
    for (const k of ['text', 'content', 'body', 'output', 'response']) {
      const v = parsed[k];
      if (typeof v === 'string' && v.trim().length > 0) {
        return { text: v, provenance };
      }
    }
    // Nested messages array, e.g. `{ messages: [...] }`.
    for (const k of ['messages', 'turns', 'conversation', 'history']) {
      const v = parsed[k];
      if (Array.isArray(v) && looksLikeMessageArray(v)) {
        return extractFromJson(JSON.stringify(v));
      }
    }
    // Anthropic-style content array on the top object.
    const content = parsed['content'];
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (typeof part === 'string') parts.push(part);
        else if (isPlainObject(part) && typeof part['text'] === 'string') {
          parts.push(part['text'] as string);
        }
      }
      if (parts.length > 0) return { text: parts.join('\n').trim(), provenance };
    }
    // Last-ditch: pretty-print the whole object so SOMETHING flows downstream.
    return { text: JSON.stringify(parsed, null, 2), provenance };
  }

  if (typeof parsed === 'string') return { text: parsed, provenance: null };

  return { text: String(parsed ?? ''), provenance: null };
}

interface MarkdownExtraction {
  text: string;
  provenance: string | null;
}

// Best-effort YAML frontmatter parse for `agent:`/`model:`/`producer:`/`tool:`.
function extractFromMarkdown(raw: string): MarkdownExtraction {
  let provenance: string | null = null;
  let body = raw;

  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (fmMatch) {
    const fm = fmMatch[1] ?? '';
    body = raw.slice(fmMatch[0].length);
    for (const line of fm.split(/\r?\n/)) {
      const m = /^\s*(agent|model|producer|tool)\s*:\s*(.+?)\s*$/i.exec(line);
      if (m) {
        const val = (m[2] ?? '').replace(/^['"]|['"]$/g, '').trim();
        if (val.length > 0) {
          provenance = val;
          break;
        }
      }
    }
  }

  return { text: body, provenance };
}

// Filename-based provenance hint, e.g. `audit-claude-2026-04-29.md` → "Claude".
function provenanceFromFilename(name: string): string | null {
  // T181: word-boundary regex matching to avoid substring false positives
  // (e.g. "exclude" matching "claude").
  const known: Array<[RegExp, string]> = [
    [/\bclaude\b/i, 'Claude'],
    [/\bgemini\b/i, 'Gemini'],
    [/\bgpt[-_]?4\b/i, 'GPT-4'],
    [/\bgpt[-_]?3\b/i, 'GPT-3'],
    [/\bopenai\b/i, 'OpenAI'],
    [/\banthropic\b/i, 'Anthropic'],
    [/\bllama\b/i, 'Llama'],
    [/\bmistral\b/i, 'Mistral'],
  ];
  for (const [re, label] of known) {
    if (re.test(name)) return label;
  }
  return null;
}

// ---------- Public API ----------

export async function ingestAgentReport(
  opts: IngestAgentReportOptions,
): Promise<Brief> {
  // FR-035 / SC-016 — sole-source refusal for medicine.
  if (opts.domain === 'medicine' && opts.isPartOfBundle !== true) {
    throw new Error(
      'Medicine refuses agent-report as sole source per FR-035 / SC-016. ' +
        'Provide primary source material (textbook PDF, clinical guideline, journal article).',
    );
  }

  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestAgentReport: sourcePath does not exist: ${absInput}`);
  }
  const st = statSync(absInput);
  if (!st.isFile()) {
    throw new Error(`ingestAgentReport: sourcePath is not a file: ${absInput}`);
  }

  const raw = readFileSync(absInput, 'utf8');
  if (raw.trim().length === 0) {
    throw new Error(`ingestAgentReport: file is empty: ${absInput}`);
  }

  const fname = basename(absInput);
  const format = detectFormat(absInput, raw);

  let extractedText: string;
  let bodyProvenance: string | null = null;

  if (format === 'json') {
    const ex = extractFromJson(raw);
    extractedText = ex.text;
    bodyProvenance = ex.provenance;
  } else if (format === 'markdown') {
    const ex = extractFromMarkdown(raw);
    extractedText = ex.text;
    bodyProvenance = ex.provenance;
  } else {
    extractedText = raw;
  }

  if (extractedText.trim().length === 0) {
    throw new Error(
      `ingestAgentReport: no text extracted from ${fname} ` +
        `(format=${format}). Expected a 'text', 'content', or 'body' field, ` +
        `or markdown/plain text body.`,
    );
  }

  // Provenance: body-extracted hint > filename hint > null.
  const agentSourceProvenance: string | null =
    bodyProvenance ?? provenanceFromFilename(fname);

  // FR-030: copy source into <lessonOutputDir>/source/.
  const copied = await copySources(
    [{ path: absInput, kind: 'agent-report' }],
    `${opts.lessonOutputDir}/source`,
  );
  const sourceCopiedTo = copied[0]?.copiedPath ?? null;
  const manifestPath = sourceCopiedTo ?? absInput;

  // Cheap token estimate (chars/4) — adapters don't tokenize precisely.
  const approxTokens = Math.max(1, Math.ceil(extractedText.length / 4));

  const manifestEntry: SourceFileEntry = {
    path: manifestPath,
    role: 'agent-report',
    extractor: 'agent-report',
    tokenCount: approxTokens,
    extractedAt: Date.now(),
  };

  const provenanceLabel = agentSourceProvenance ?? 'unknown agent';
  stage(0, 5, `ingest: agent-report (${provenanceLabel})`);

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType: 'agent-report',
    sourcePath: absInput,
    sourceCopiedTo,
    extractedText,
    sourceManifest: [manifestEntry],
    agentSourceProvenance,
    metadata: {
      format,
      bytes: st.size,
      approxTokens,
      isPartOfBundle: opts.isPartOfBundle === true,
      filename: fname,
    },
    briefSchemaVersion: '1',
  };

  return brief;
}
