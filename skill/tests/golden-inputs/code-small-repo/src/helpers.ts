/**
 * Higher-level helpers built on the `Result<T, E>` core.
 *
 * These functions cover the everyday cases: turning thrown errors into
 * results, sequencing computations, and aggregating many results into one.
 */
import { ok, err, type Result } from "./result.js";

/**
 * Run `fn` and capture any thrown value as an `Err<Error>`.
 *
 * Non-`Error` throws (strings, plain objects) are wrapped in `new Error(...)`
 * so callers can rely on a uniform error type.
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (e) {
    return err(toError(e));
  }
}

/**
 * Async variant of `tryCatch`. Awaits the promise and converts a rejection
 * into an `Err<Error>`.
 */
export async function tryCatchAsync<T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toError(e));
  }
}

/**
 * Monadic bind: feed the success value of `r` into `fn`, which itself
 * returns a `Result`. Short-circuits on `Err`.
 *
 * Lets you sequence fallible operations without nesting `if (isOk(...))`.
 */
export function chain<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/**
 * Collect an array of `Result`s into a single `Result` of an array.
 *
 * Returns the first `Err` encountered, or an `Ok` containing all values in
 * order if every input is `Ok`.
 */
export function combine<T, E>(rs: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

/** Coerce an unknown thrown value into an `Error`. */
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  try {
    return new Error(JSON.stringify(e));
  } catch {
    return new Error(String(e));
  }
}
