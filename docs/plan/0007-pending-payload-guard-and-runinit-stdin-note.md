# 0007: `assertPendingPayload` type guard plus `runInit` stdin documentation note

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

Two related additions at the package's boundary with external code:

1. **`assertPendingPayload`** lets a future consumer (OpenClaw, a CLI
   driver, anyone reading `.standards/pending.json`) validate the file
   shape before relying on it. Today the type lives only on the writer
   side; readers would have to assume the shape or duplicate the schema.
2. **`runInit` JSDoc note about `process.stdin` closure.** When
   `runInit` is called as a library with default streams and
   `interactive: true`, the readline interface's `close()` propagates
   to `process.stdin`, so subsequent stdin reads from the caller's
   process fail. The behavior is acceptable for the CLI's single-shot
   lifecycle but surprises library callers; the note makes it
   discoverable at the call site.

Both items target the same audience — code that consumes this package
as a library rather than as a CLI binary — which justifies grouping
them in one PR. The PR adds new behavior (the exported guard) and
adjusts in-source documentation.

The recommended workflow is Feature because the guard is new
functionality with tests; the JSDoc note rides along as in-source
documentation in the same module file (`src/init.ts`) being touched in
the wider area.

## Architecture decisions

- **`assertPendingPayload` follows the existing
  `assertRepoMeta`/`assertManifest` pattern.** Same structural checks
  with `typeof` and array verification; throws `TypeError` on mismatch
  with a descriptive, field-naming message. No third-party schema
  library.
- **Validate `schemaVersion: 1` strictly.** Future schema versions
  trigger an explicit mismatch error instead of silently parsing as
  v1.
- **Guard is exported from `src/sync.ts`** alongside the existing
  `PendingPayload` type. Consumers import the type and the guard
  together.
- **JSDoc note is the lightest possible footprint.** No code change to
  `runInit` itself; the note describes existing behavior so callers
  can make informed choices. The note attaches to the exported
  `runInit` function and mentions the `streams` option as the way to
  avoid the side effect.

## Affected files

| File                     | Description                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sync.ts`            | New `assertPendingPayload(value: unknown): asserts value is PendingPayload`. Checks: object, `schemaVersion === 1`, `fromVersion`/`toVersion` numbers, `scopes`/`exceptions` arrays of strings, `visibility ∈ {"oss", "private"}`, `prompt` is string, `changes` is an array of `{ file: string, version: number, scopes: string[], content: string }`. Throws on mismatch.                                            |
| `src/init.ts`            | Add a multi-line JSDoc above `runInit`. Describes parameters briefly, then notes: "Interactive mode uses `node:readline/promises` on the supplied streams. When called with the default streams (omitted `options.streams`) and `options.interactive` true, closing the underlying readline interface also closes `process.stdin`. Library callers that need stdin afterwards should pass explicit `options.streams`." |
| `test/standards.test.ts` | (a) `assertPendingPayload` round-trips from `buildPendingPayload` successfully; (b) rejects: `schemaVersion: 2`, missing `fromVersion`, `scopes: "common"` (string instead of array), `visibility: "internal"` (unknown value), invalid `changes` entry.                                                                                                                                                               |

## Implementation details

### Approach

1. **`assertPendingPayload` in `src/sync.ts`.**
   - Signature: `export function assertPendingPayload(value: unknown): asserts value is PendingPayload`.
   - Use a local `isRecord(value: unknown): value is Record<string, unknown>` helper analogous to the one in `src/repo.ts`/`src/manifest.ts`.
   - Field-by-field checks: `value.schemaVersion === 1`, numeric `fromVersion`/`toVersion`, array of strings for `scopes` and `exceptions`, `value.visibility ∈ {"oss", "private"}`, string `prompt`, array `changes`, and for each entry: string `file`, numeric `version`, array of strings `scopes`, string `content`.
   - Throw `TypeError("Invalid pending payload: <field name> ...")` with the failing field named.
2. **JSDoc note above `runInit` in `src/init.ts`.**
   - Add a `/** ... */` block immediately above the `export async function runInit`. Single short paragraph describing the parameters at a high level, plus one paragraph noting the stdin-closure side effect with the mitigation (`pass options.streams`).
   - No code change to the function body.
3. **Tests.**
   - One round-trip test: build a payload via `buildPendingPayload(cwd, 0)` on a fresh fixture, serialize/parse through JSON, then call `assertPendingPayload` on the parsed value. Must not throw.
   - One rejection test per shape mismatch. Use deep-cloned payloads with one field mutated each. Five cases listed above.
4. **No changes to production code paths beyond the new export and the JSDoc.** The behavior of `runInit`, `buildPendingPayload`, and `writePending` is unchanged.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **Schema version mismatch.** Producer writes `schemaVersion: 2`; the
  guard refuses with an explicit message instead of silently treating
  it as v1.
- **Empty `changes` array.** Valid — `buildPendingPayload` never
  returns a payload with empty `changes` today (it returns `undefined`
  in that case), but the guard accepts an empty array because the
  schema allows it conceptually. Test asserts the guard accepts an
  empty `changes` array on a manually constructed valid payload.
- **`exceptions` missing.** Plan 0001 writes `exceptions: []` always,
  so the guard requires the field. Documented in the error message.
- **JSDoc note placement.** Placed directly above `export async function runInit`. Build (tsc) and lint (oxlint/eslint) treat it as documentation; no runtime impact.
- **Future library caller that relies on the stdin-closure note.** The
  note describes existing behavior; no API contract changes.

## Acceptance criteria

- [x] `assertPendingPayload` is exported from `src/sync.ts` and accepts
      a payload that round-trips through `JSON.parse(JSON.stringify(...))`.
- [x] `assertPendingPayload` rejects each of: wrong `schemaVersion`,
      missing `fromVersion`, non-array `scopes`, unknown `visibility`
      value, malformed `changes` entry.
- [x] `runInit` carries a JSDoc block that names the stdin-closure
      side effect and recommends `options.streams` as the mitigation.
- [x] `pnpm agent:check` passes.
- [x] No new runtime dependency is added to `package.json`.

## Validation plan

- **Unit tests (vitest):**
  - One round-trip test for the happy path.
  - Five rejection tests, one per mismatched shape.
- **JSDoc inspection:** `tsc --noEmit` reports no errors with the new
  documentation block; the `runInit` symbol's hover text in an IDE
  includes the stdin-closure note.
- **Self-check:** `pnpm check:self` stays green; the new export does
  not change the standards check itself.

## Assumptions and open points

- **Verified:** `assertRepoMeta` and `assertManifest` already exist in
  `src/repo.ts` and `src/manifest.ts` with the same throw-on-mismatch
  pattern; the new guard mirrors their style.
- **Verified:** `runInit`'s interactive code path closes the readline
  interface in a `finally` block (`src/init.ts`, `resolveInteractive`);
  with default `process.stdin`/`process.stdout`, that closes
  `process.stdin` as a documented side effect of `readline`.
- **Assumption:** parallel plans (0003, 0004, 0005, 0006, 0008) do not
  add competing guard functions in `src/sync.ts` and do not change the
  `runInit` JSDoc block. Plan 0008 also touches `test/standards.test.ts`
  (subprocess TTY test) but in a separate describe block; merge
  conflict potential is low.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    1 |
| Security        |        0 |         0 |    0 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    1 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    1 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** The guard follows the existing
  `assertRepoMeta`/`assertManifest` style; no new pattern is
  introduced.
- **Failure modes — hint:** The guard provides clear, field-named
  errors instead of leaving downstream consumers to inspect raw JSON.
- **Testability — hint:** Round-trip plus per-field rejection tests
  exercise both the happy path and every documented failure mode.
- **Scope — hint:** Both items target the same audience (library
  callers) and touch adjacent module surfaces; bundling them avoids
  two micro-PRs.
- **Maintainability — hint:** `schemaVersion: 1` validation gives a
  clean migration path for any future `PendingPayload` revision; the
  JSDoc note makes a subtle runtime side effect explicit in source.

## Test results

**Date:** 2026-06-18
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                              |
| ------------------------------------- | ----------------------------------- |
| oxlint + eslint                       | green, no warnings                  |
| oxfmt format:check                    | green                               |
| tsc (root + build)                    | green                               |
| vitest                                | 47/47 tests passed                  |
| `node dist/cli.js check` (self-check) | "Repository matches org standards." |

Seven new tests in a dedicated `describe("assertPendingPayload", ...)`
block cover the round-trip from `buildPendingPayload`, an empty
`changes` array on a manually built payload, and five rejection paths
(wrong `schemaVersion`, missing `fromVersion`, non-array `scopes`,
unknown `visibility` value, malformed `changes[0]` entry).

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     0 |

Keine Findings gefunden. Type-guard splits into three small helpers to
stay within the project's complexity/statement-count limits; tests use
`structuredClone` per project lint preference. JSDoc note describes
existing readline-closure behavior with the documented mitigation
(`options.streams`).
