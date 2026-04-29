/**
 * Chiron — stderr progress emitter (T022, R-05 / FR-028).
 *
 * Pipeline stages call `progress(stage, msg)` to surface human-readable
 * status without polluting stdout (which is reserved for the lesson HTML
 * pipeline output). All output goes to `process.stderr`.
 *
 * Format: `[chiron][<stage>] <msg>` — e.g. `[chiron][stage 2/5] syllabus: 6 chapters planned`.
 */

export interface ProgressOpts {
  /** Optional 0-100 percentage; rendered as `(42%)` suffix. */
  pct?: number;
}

/** Emit a single progress line to stderr. */
export function progress(stage: string, msg: string, opts: ProgressOpts = {}): void {
  const pct = typeof opts.pct === 'number'
    ? ` (${Math.max(0, Math.min(100, Math.round(opts.pct)))}%)`
    : '';
  process.stderr.write(`[chiron][${stage}] ${msg}${pct}\n`);
}

/**
 * Wrap an async function with start/finish progress lines and elapsed
 * timing. Errors are re-thrown unchanged after a `failed` line is emitted.
 */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  progress(label, 'start');
  try {
    const result = await fn();
    const ms = Date.now() - start;
    progress(label, `done (${ms}ms)`);
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    progress(label, `failed after ${ms}ms: ${msg}`);
    throw err;
  }
}

/** Convenience helpers for the canonical stage / chapter prefixes. */
export const stage = (n: number, total: number, msg: string): void =>
  progress(`stage ${n}/${total}`, msg);

export const chapter = (
  stageN: number,
  chapN: number,
  chapTotal: number,
  msg: string,
): void =>
  progress(`stage ${stageN}/5 chapter ${chapN}/${chapTotal}`, msg);
