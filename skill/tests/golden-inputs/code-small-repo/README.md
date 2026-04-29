# result-util

A tiny, dependency-free `Result<T, E>` (a.k.a. `Either`) type for TypeScript,
plus a handful of ergonomic helpers for working with operations that might
fail.

> **Teaching fixture.** This repository is a golden input used by the Chiron
> lesson generator's test suite. It is intentionally small (~200 lines of
> source) and self-contained. It is MIT-licensed so it can be redistributed
> verbatim inside Chiron's test artifacts.

## Install

```bash
npm install result-util
```

## Usage

Wrap a throwing function:

```ts
import { tryCatch, isOk, unwrap } from "result-util";

const parsed = tryCatch(() => JSON.parse(input));
if (isOk(parsed)) {
  console.log(parsed.value);
}
```

Transform success values without unwrapping:

```ts
import { ok, map } from "result-util";

const doubled = map(ok(21), (n) => n * 2);
// => { ok: true, value: 42 }
```

Combine many results into one:

```ts
import { combine, ok, err } from "result-util";

combine([ok(1), ok(2), ok(3)]);    // => Ok([1, 2, 3])
combine([ok(1), err("nope"), ok(3)]); // => Err("nope")
```

## API

- `ok(value)`, `err(error)` — constructors
- `isOk(r)`, `isErr(r)` — type guards
- `unwrap(r)`, `unwrapOr(r, default)` — extraction
- `map(r, fn)`, `mapErr(r, fn)` — transforms
- `tryCatch(fn)`, `tryCatchAsync(fn)` — convert thrown errors to `Result`
- `chain(r, fn)` — monadic bind
- `combine(rs)` — collect an array of results

## License

MIT — see [LICENSE](./LICENSE).
