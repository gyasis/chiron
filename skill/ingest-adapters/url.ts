// Stage 0 INGEST adapter — url / html-file (FR-032 i, j)
//
// Handles two input shapes:
//   1. http(s) URL — fetched via Node 20 built-in `fetch` (30s timeout). NOT
//      copied to the lesson dir — the URL itself is the canonical reference,
//      mirroring the FR-030 carve-out used by code-repo.
//   2. Local `.html` file — read from disk and copied into
//      `<lessonOutputDir>/source/` via `copySources()`.
//
// In both cases the HTML is sanitized to plain text with a small regex pass
// (no external HTML parser dependency, per task brief). This adapter MUST NOT
// call any LLM — Stage 0 is deterministic.

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Brief, Domain, Mode, SourceType } from '../lib/schemas/brief.js';
import { copySources } from '../lib/source-copy.js';
import { stage as progressStage } from '../lib/progress.js';

export interface IngestUrlOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: Mode;
  domain: Domain;
}

// ---------- HTML sanitization ----------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = parseInt(body.slice(2), 16);
      if (Number.isFinite(cp) && cp > 0) {
        try {
          return String.fromCodePoint(cp);
        } catch {
          return '';
        }
      }
      return '';
    }
    if (body.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0) {
        try {
          return String.fromCodePoint(cp);
        } catch {
          return '';
        }
      }
      return '';
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? `&${body};`;
  });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m || !m[1]) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

function extractMeta(html: string, name: string): string | null {
  // Match <meta name="X" content="Y"> in either attribute order.
  const re1 = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i',
  );
  const m = html.match(re1) ?? html.match(re2);
  if (!m || !m[1]) return null;
  const v = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}

function extractOgProperty(html: string, prop: string): string | null {
  const re1 = new RegExp(
    `<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${prop}["']`,
    'i',
  );
  const m = html.match(re1) ?? html.match(re2);
  if (!m || !m[1]) return null;
  const v = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}

function sanitizeHtml(raw: string): string {
  let s = raw;
  // Strip <script>, <style>, <head> blocks entirely.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '');
  // Strip HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Convert block-level tags to newlines.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/?\s*(p|div|section|article|header|footer|nav|aside|h[1-6]|li|ul|ol|tr|table|thead|tbody|tfoot|blockquote|pre)\b[^>]*>/gi, '\n');
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode entities.
  s = decodeEntities(s);
  // Collapse whitespace within lines, then trim each line.
  const lines = s.split(/\r?\n/).map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim());
  // Collapse multiple blank lines to a single blank line (i.e. two newlines).
  const out: string[] = [];
  let blankRun = 0;
  for (const l of lines) {
    if (l === '') {
      blankRun += 1;
      if (blankRun <= 1) out.push('');
    } else {
      blankRun = 0;
      out.push(l);
    }
  }
  return out.join('\n').trim();
}

// ---------- Public API ----------

export async function ingestUrl(opts: IngestUrlOptions): Promise<Brief> {
  const isUrl = /^https?:\/\//i.test(opts.sourcePath);

  progressStage(0, 5, `ingest: url (${opts.sourcePath})`);

  let rawHtml: string;
  let sourceType: SourceType;
  let metadata: Record<string, unknown> = {};
  let sourceCopiedTo: string | null = null;
  let canonicalSourcePath: string;

  if (isUrl) {
    sourceType = 'url';
    canonicalSourcePath = opts.sourcePath;

    let resp: Response;
    try {
      resp = await fetch(opts.sourcePath, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ingestUrl: fetch failed for ${opts.sourcePath}: ${msg}`);
    }

    if (!resp.ok) {
      throw new Error(
        `ingestUrl: HTTP ${resp.status} ${resp.statusText} for ${opts.sourcePath}`,
      );
    }

    const contentType = resp.headers.get('content-type') ?? '';
    const ctLower = contentType.toLowerCase();
    if (
      !ctLower.includes('text/html') &&
      !ctLower.includes('text/plain') &&
      !ctLower.includes('application/xhtml')
    ) {
      throw new Error(
        `ingestUrl: unsupported Content-Type '${contentType}' for ${opts.sourcePath} ` +
          `(expected text/html or text/plain)`,
      );
    }

    rawHtml = await resp.text();
    metadata = {
      httpStatus: resp.status,
      contentType,
      originalUrl: opts.sourcePath,
      finalUrl: resp.url || opts.sourcePath,
    };
  } else {
    sourceType = 'html-file';
    const absInput = resolve(opts.sourcePath);
    if (!existsSync(absInput)) {
      throw new Error(`ingestUrl: local file does not exist: ${absInput}`);
    }
    const st = statSync(absInput);
    if (!st.isFile()) {
      throw new Error(`ingestUrl: not a regular file: ${absInput}`);
    }
    if (!/\.html?$/i.test(absInput)) {
      throw new Error(
        `ingestUrl: local file must have .html or .htm extension: ${absInput}`,
      );
    }
    canonicalSourcePath = absInput;
    rawHtml = readFileSync(absInput, 'utf8');

    const copied = await copySources(
      [{ path: absInput, kind: 'html-file' }],
      `${opts.lessonOutputDir}/source`,
    );
    sourceCopiedTo = copied[0]?.copiedPath ?? null;
    metadata = {
      sourceFileBytes: st.size,
      sha256: copied[0]?.sha256 ?? null,
    };
  }

  // Pull title / description / og:title BEFORE stripping head.
  const title = extractTitle(rawHtml);
  const description =
    extractMeta(rawHtml, 'description') ?? extractOgProperty(rawHtml, 'og:description');
  const ogTitle = extractOgProperty(rawHtml, 'og:title');
  if (title) metadata.title = title;
  else if (ogTitle) metadata.title = ogTitle;
  if (description) metadata.description = description;

  const extractedText = sanitizeHtml(rawHtml);
  if (extractedText === '') {
    throw new Error(
      `ingestUrl: sanitized text is empty for ${canonicalSourcePath} ` +
        `(page may be entirely script/style or non-textual)`,
    );
  }

  const brief: Brief = {
    domain: opts.domain,
    mode: opts.mode,
    sourceType,
    sourcePath: canonicalSourcePath,
    sourceCopiedTo,
    extractedText,
    metadata,
    briefSchemaVersion: '1',
  };

  return brief;
}
