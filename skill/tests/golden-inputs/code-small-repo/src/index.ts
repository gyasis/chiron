/**
 * result-util — public entry point.
 *
 * Re-exports the `Result<T, E>` type and helpers. Consumers should import
 * from here rather than reaching into the individual modules.
 */
export {
  type Result,
  type Ok,
  type Err,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
} from "./result.js";

export { tryCatch, tryCatchAsync, chain, combine } from "./helpers.js";
