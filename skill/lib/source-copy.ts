/**
 * Chiron — source-copy utility (T023, FR-030).
 *
 * Used by Stage 0 ingest adapters: copies any local source file (PDF, image,
 * code repo file, vocab CSV, agent-report MD, …) into
 * `<lesson-output-dir>/source/`, preserving the file's basename and computing
 * a sha256 for traceability.
 *
 * Returns one entry per input describing where the original lived, where it
 * landed, and the hash. Existing files at the destination are overwritten —
 * the lesson directory is the canonical staging area.
 */

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { safeJoin, PathTraversalError } from './path-safety.js';

export interface SourceInput {
  /** Absolute or cwd-relative path to the original file on disk. */
  path: string;
  /** Source-type tag from FR-032 (e.g. 'pdf', 'image', 'code-repo', 'vocab-list'). */
  kind: string;
  /**
   * Optional sub-path under `<destDir>/` to preserve a folder structure
   * (e.g. for image folders or bundles). Defaults to the file's basename.
   */
  relPath?: string;
}

export interface CopiedSource {
  originalPath: string;
  copiedPath: string;
  sha256: string;
  kind: string;
}

async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Copy `sources` into `<destDir>/`. `destDir` is typically
 * `<lesson-output-dir>/source/`. Creates the directory if absent.
 */
export async function copySources(
  sources: Array<SourceInput>,
  destDir: string,
): Promise<CopiedSource[]> {
  const absDest = resolve(destDir);
  await mkdir(absDest, { recursive: true });

  const out: CopiedSource[] = [];
  for (const s of sources) {
    const absSrc = resolve(s.path);
    const rel = s.relPath ?? basename(absSrc);
    // T149: safeJoin prevents ../-traversal in relPath.
    let target: string;
    try {
      target = safeJoin(absDest, rel);
    } catch (e) {
      if (e instanceof PathTraversalError) {
        throw new Error('source-copy: refused to copy outside lesson dir: ' + rel + ' (' + e.message + ')');
      }
      throw e;
    }

    // Ensure any nested sub-dirs exist before copying.
    const targetDir = target.slice(0, target.length - basename(target).length);
    if (targetDir && targetDir !== absDest) {
      await mkdir(targetDir, { recursive: true });
    }

    await copyFile(absSrc, target);
    const hash = await sha256OfFile(target);
    out.push({
      originalPath: absSrc,
      copiedPath: target,
      sha256: hash,
      kind: s.kind,
    });
  }
  return out;
}
