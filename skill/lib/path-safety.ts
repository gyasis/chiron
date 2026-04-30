// Path-safety helper. Use whenever a user-supplied OR LLM-supplied path
// component lands in fs.* / path.join. Prevents path traversal (`../foo`),
// absolute-path overrides (resolve replaces base), and symlink escapes.

import * as path from 'node:path';
import * as fs from 'node:fs';

export class PathTraversalError extends Error {
  override readonly name = 'PathTraversalError';
  constructor(public readonly base: string, public readonly attempted: string, msg?: string) {
    super(msg ?? `Path '${attempted}' resolves outside base '${base}'`);
  }
}

// Join base + child, then assert the result stays inside base. Rejects:
//  - absolute child paths (would override base via path.resolve semantics)
//  - parent-traversal segments (`..`) that escape base
//  - empty/whitespace-only child
// Returns the absolute resolved path.
export function safeJoin(base: string, ...children: string[]): string {
  if (!base) throw new PathTraversalError(base, children.join('/'), 'base required');
  for (const child of children) {
    if (typeof child !== 'string' || child.trim() === '') {
      throw new PathTraversalError(base, String(child), 'child path must be non-empty string');
    }
    if (path.isAbsolute(child)) {
      throw new PathTraversalError(base, child, `absolute child paths are not allowed: '${child}'`);
    }
  }
  const absBase = path.resolve(base);
  const joined = path.resolve(absBase, ...children);
  const rel = path.relative(absBase, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathTraversalError(absBase, children.join('/'));
  }
  return joined;
}

// Sanitize a single path component (e.g., a chapter id, a line id, a slug
// the LLM produced) so it cannot contain separators, leading dots, or null
// bytes. Returns the safe form. Throws if the result would be empty after
// stripping. Use BEFORE feeding a value into safeJoin when the component
// might contain user/LLM-controlled noise.
export function sanitizeComponent(raw: string): string {
  if (typeof raw !== 'string') {
    throw new PathTraversalError('', String(raw), 'component must be a string');
  }
  // Drop NUL bytes, path separators (/, \), and any leading dots / dashes.
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/^[.\-]+/, '')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new PathTraversalError('', raw, `component '${raw}' is empty or reserved after sanitization`);
  }
  return cleaned;
}

// True if a path is a symlink. Follows the parent's lstat.
// Use during directory walks before deciding whether to recurse into the
// child — prevents infinite loops on symlink cycles AND blocks symlinks
// pointing outside the intended root (e.g. `evil-link → /etc/passwd`).
export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// Resolve a symlink and assert the target stays inside root. Returns the
// resolved absolute path on success; throws PathTraversalError if the
// link target escapes root. Use when you must dereference a link
// instead of skipping it.
export function resolveSymlinkInsideRoot(linkPath: string, root: string): string {
  const absRoot = path.resolve(root);
  const resolved = fs.realpathSync(linkPath);
  const rel = path.relative(absRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathTraversalError(absRoot, linkPath, `symlink '${linkPath}' points outside root: ${resolved}`);
  }
  return resolved;
}
