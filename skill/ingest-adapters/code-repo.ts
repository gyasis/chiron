// Stage 0 INGEST adapter — code-repo (FR-032 f)
//
// Handles git repos / local dirs / single source files. Walks the tree respecting
// .gitignore plus a hardcoded skip-list, picks the most-relevant ~10-20 files for
// `extractedText`, and produces a `Brief` with `sourceType: 'code-repo'`.
//
// FR-030 carve-out: source is NOT copied — `sourceCopiedTo` is null and
// `sourcePath` is the absolute path to the repo root (referenced by path).
// This adapter MUST NOT call any LLM (Stage 0 is deterministic).

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, relative, basename, extname, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import type { Brief } from '../lib/schemas/brief.js';

// Directories always skipped, regardless of .gitignore
const ALWAYS_SKIP_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'out',
  'coverage',
]);

// Binary / non-text extensions — skipped entirely
const BINARY_EXTS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.mov', '.avi', '.mkv', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.bin', '.class', '.jar',
  '.pyc', '.pyo', '.wasm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.db', '.sqlite', '.sqlite3',
  '.lock', // package locks are noisy; skip from extracted text
]);

// Language detection priority order (FR description: .ts > .py > .go > .js > .rs > .java)
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.scala': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
};

const LANG_PRIORITY: string[] = [
  'typescript', 'python', 'go', 'javascript', 'rust', 'java',
  'kotlin', 'swift', 'ruby', 'php', 'c', 'cpp', 'csharp', 'scala', 'shell',
];

const MAX_LINES_PER_FILE = 500;
const MAX_FILES_IN_EXTRACT = 20;

// ---------- .gitignore parsing ----------

interface GitignoreRule {
  pattern: string;
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean; // pattern with leading '/' is anchored to repo root
}

function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    let pattern = line;
    let negate = false;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith('/')) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    let anchored = false;
    if (pattern.startsWith('/')) {
      anchored = true;
      pattern = pattern.slice(1);
    }
    if (pattern === '') continue;
    rules.push({ pattern, negate, dirOnly, anchored });
  }
  return rules;
}

// Translate a (simplified) gitignore glob to a RegExp.
// Supports: '*' (any chars except '/'), '**' (any chars including '/'), '?' (single char).
// Treats every other regex metachar literally.
function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^$|()[]{}\\'.includes(c!)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function ruleMatches(
  rule: GitignoreRule,
  relPath: string,
  isDir: boolean,
): boolean {
  if (rule.dirOnly && !isDir) return false;

  const re = globToRegex(rule.pattern);

  if (rule.anchored) {
    return re.test(relPath);
  }
  // Unanchored: rule may match the full path or any path segment / suffix.
  if (re.test(relPath)) return true;
  // Match against any trailing segment chain.
  const parts = relPath.split('/');
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join('/');
    if (re.test(tail)) return true;
  }
  return false;
}

function isIgnored(
  relPath: string,
  isDir: boolean,
  rules: GitignoreRule[],
): boolean {
  // Last matching rule wins (gitignore semantics).
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(rule, relPath, isDir)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

// ---------- Repo walking ----------

interface CollectedFile {
  absPath: string;
  relPath: string;
  ext: string;
}

function walk(
  rootDir: string,
  rules: GitignoreRule[],
  out: CollectedFile[],
  current: string = rootDir,
): void {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(current, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = relative(rootDir, abs).split(/[\\/]/).join('/');
    const isDir = st.isDirectory();

    if (isDir) {
      if (ALWAYS_SKIP_DIRS.has(name)) continue;
      if (isIgnored(rel, true, rules)) continue;
      walk(rootDir, rules, out, abs);
    } else if (st.isFile()) {
      if (isIgnored(rel, false, rules)) continue;
      const ext = extname(name).toLowerCase();
      if (BINARY_EXTS.has(ext)) continue;
      out.push({ absPath: abs, relPath: rel, ext });
    }
  }
}

// ---------- Language detection ----------

function detectPrimaryLanguage(files: CollectedFile[]): string | null {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const lang = LANG_BY_EXT[f.ext];
    if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  const present = Object.keys(counts);
  if (present.length === 0) return null;

  // Sort by count desc, ties broken by LANG_PRIORITY order.
  present.sort((a, b) => {
    const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
    if (diff !== 0) return diff;
    const pa = LANG_PRIORITY.indexOf(a);
    const pb = LANG_PRIORITY.indexOf(b);
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
  });
  return present[0] ?? null;
}

// ---------- File ranking for extract ----------

function fileImportanceScore(rel: string): number {
  const lower = rel.toLowerCase();
  const base = basename(lower);
  let score = 0;
  // Top-level docs / manifests
  if (base === 'readme.md' || base === 'readme') score += 1000;
  if (base === 'package.json') score += 900;
  if (base === 'cargo.toml') score += 900;
  if (base === 'go.mod') score += 900;
  if (base === 'pyproject.toml') score += 900;
  if (base === 'setup.py') score += 850;
  if (base === 'requirements.txt') score += 800;
  if (base === 'tsconfig.json') score += 700;
  // Entry points
  if (/^(index|main|cli|app|server)\.[a-z]+$/.test(base)) score += 600;
  // Penalize depth — shallower files are more "architectural"
  const depth = rel.split('/').length - 1;
  score -= depth * 10;
  // Boost source-language files
  if (LANG_BY_EXT[extname(base)]) score += 50;
  // Penalize tests
  if (lower.includes('/test/') || lower.includes('/tests/') || /\.test\.|\.spec\./.test(base)) score -= 80;
  return score;
}

function readFileCapped(absPath: string, maxLines: number): string {
  let content: string;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n// ... [truncated at ${maxLines} lines]\n`;
}

// ---------- Public API ----------

export interface IngestCodeRepoOptions {
  sourcePath: string;
  lessonOutputDir: string;
  mode: 'A' | 'B';
}

export function ingestCodeRepo(opts: IngestCodeRepoOptions): Brief {
  const absInput = resolve(opts.sourcePath);
  if (!existsSync(absInput)) {
    throw new Error(`ingestCodeRepo: sourcePath does not exist: ${absInput}`);
  }
  const inputStat = statSync(absInput);

  let repoRoot: string;
  let singleFile: string | null = null;

  if (inputStat.isDirectory()) {
    repoRoot = absInput;
  } else if (inputStat.isFile()) {
    repoRoot = dirname(absInput);
    singleFile = absInput;
  } else {
    throw new Error(
      `ingestCodeRepo: sourcePath is neither a file nor a directory: ${absInput}`,
    );
  }

  // repoSha: best-effort `git rev-parse HEAD`. null if not a git repo.
  let repoSha: string | null = null;
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = out.trim();
    if (/^[0-9a-f]{7,40}$/i.test(trimmed)) repoSha = trimmed;
  } catch {
    repoSha = null;
  }

  // Collect files.
  let files: CollectedFile[];
  if (singleFile !== null) {
    const ext = extname(singleFile).toLowerCase();
    files = BINARY_EXTS.has(ext)
      ? []
      : [{
          absPath: singleFile,
          relPath: basename(singleFile),
          ext,
        }];
  } else {
    const gitignorePath = join(repoRoot, '.gitignore');
    let rules: GitignoreRule[] = [];
    if (existsSync(gitignorePath)) {
      try {
        rules = parseGitignore(readFileSync(gitignorePath, 'utf8'));
      } catch {
        rules = [];
      }
    }
    files = [];
    walk(repoRoot, rules, files);
  }

  const primaryLanguage = detectPrimaryLanguage(files);
  const fileCount = files.length;

  // Pick top files for extract.
  const ranked = [...files]
    .map((f) => ({ f, score: fileImportanceScore(f.relPath) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES_IN_EXTRACT)
    .map((x) => x.f);

  const chunks: string[] = [];
  for (const f of ranked) {
    const body = readFileCapped(f.absPath, MAX_LINES_PER_FILE);
    if (body === '') continue;
    chunks.push(`// === ${f.relPath} ===\n${body}`);
  }
  const extractedText = chunks.join('\n\n');

  // FR-030 carve-out: do NOT copy source for code-repo. Reference by path.
  // (lessonOutputDir is accepted for adapter-API symmetry but intentionally unused.)
  void opts.lessonOutputDir;

  const brief: Brief = {
    domain: 'code',
    mode: opts.mode,
    sourceType: 'code-repo',
    sourcePath: repoRoot,
    sourceCopiedTo: null,
    extractedText,
    metadata: {
      repoSha,
      fileCount,
      primaryLanguage,
    },
    briefSchemaVersion: '1',
  };

  return brief;
}
