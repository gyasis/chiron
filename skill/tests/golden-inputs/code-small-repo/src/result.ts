/**
 * A discriminated-union `Result<T, E>` type.
 *
 * Use `ok(value)` for success and `err(error)` for failure. Narrow with the
 * `isOk` / `isErr` type guards before reaching for `.value` or `.error`.
 */

/** Successful variant of `Result`. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failed variant of `Result`. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Either an `Ok<T>` or an `Err<E>`. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Construct a successful `Result`. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct a failed `Result`. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrow `r` to `Ok<T>`. */
export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok === true;
}

/** Narrow `r` to `Err<E>`. */
export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return r.ok === false;
}

/**
 * Extract the success value. Throws if `r` is an `Err`.
 *
 * Prefer `unwrapOr` or pattern-matching on `isOk`/`isErr` when you cannot
 * tolerate exceptions at the call site.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  if (r.error instanceof Error) throw r.error;
  throw new Error(`Called unwrap on an Err: ${String(r.error)}`);
}

/** Extract the success value, or fall back to `defaultValue` on `Err`. */
export function unwrapOr<T, E>(r: Result<T, E>, defaultValue: T): T {
  return r.ok ? r.value : defaultValue;
}

/**
 * Transform the success value of `r`, leaving an `Err` untouched.
 *
 * Equivalent to `Functor.map` for the `Result` type.
 */
export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/**
 * Transform the error value of `r`, leaving an `Ok` untouched.
 *
 * Useful for normalizing error types as a `Result` flows through layers.
 */
export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}
