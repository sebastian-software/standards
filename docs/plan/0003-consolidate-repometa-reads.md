# 0003: Consolidate `.repometa.json` reads in the apply pipeline

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Refactoring (`/refactor`)

## Requirement

`applyCommand` currently reads `.repometa.json` three times within a
single `standards apply --emit-pending` invocation: once explicitly to
capture the pre-bump version, a second time inside `runApply` (via
`createContext`), and a third time inside `buildPendingPayload`. The
plan removes the redundant reads by passing the parsed `RepoMeta`
through the call chain, so every invocation reads the file at most once.

No behavior change is intended — the post-bump value written by
`runApply` is still observable through `readRepoMeta` for any caller
that needs it. This is a maintenance and clarity cleanup, hence the
Refactoring workflow.

## Architecture decisions

- **Thread the parsed meta through, do not introduce a new context
  type.** `SyncContext` already exists and is the natural carrier, but
  promoting it across `applyCommand` would change the public surface of
  `runApply`/`buildPendingPayload` more than needed. The minimum-blast
  refactor adds an optional `preReadMeta?: RepoMeta` parameter to
  `runApply` and `buildPendingPayload`. When omitted, today's behavior
  is preserved.
- **`runApply` keeps its idempotent stamp-bump behavior.** The preloaded
  meta is only used to seed `createContext`; the bump decision still
  compares `meta.standards` against `manifest.currentVersion` exactly
  as today.
- **`syncCommand` benefits as a side effect.** The same pattern applies
  there: read once, pass through. The PR includes both call sites for
  consistency.
- **No public-API rename.** The optional parameter keeps the existing
  positional signature. External devDependency consumers (none known
  outside this repo today) are unaffected.

## Affected files

| File                     | Description                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sync.ts`            | `createContext(cwd, currentYear, preReadMeta?: RepoMeta)` accepts a preloaded meta. `buildPendingPayload(cwd, fromVersion, preReadMeta?: RepoMeta)` analogous.                                                                                       |
| `src/apply.ts`           | `runApply(cwd, currentYear, preReadMeta?: RepoMeta)` accepts and forwards the optional meta to `createContext`.                                                                                                                                      |
| `src/cli.ts`             | `applyCommand` reads meta once into a local `meta` variable and passes it to `runApply` and `writePending` (and on to `buildPendingPayload`). `syncCommand` does the same. The `safeReadRepoMeta` helper used by the `--force` path stays unchanged. |
| `src/sync.ts`            | `writePending(cwd, emitPending, fromVersion, preReadMeta?: RepoMeta)` forwards the optional meta to `buildPendingPayload`.                                                                                                                           |
| `test/standards.test.ts` | Existing tests stay green. One new test asserts that `runApply` accepts a preloaded meta and produces the same result as the unparameterized form on the same fixture.                                                                               |

## Implementation details

### Approach

1. **Extend `createContext`.** Optional third parameter `preReadMeta`. If
   provided, use it directly; otherwise call `readRepoMeta(cwd)` as
   today.
2. **Extend `runApply` and `buildPendingPayload`** with the same
   optional parameter, forwarded to `createContext` (for `runApply`)
   or used directly in place of the inline `readRepoMeta(cwd)` (for
   `buildPendingPayload`).
3. **Extend `writePending`** with the optional parameter so the
   `applyCommand` chain can pass meta end-to-end.
4. **Update `applyCommand`.** Read `.repometa.json` once into a `meta`
   local. Use `meta.standards` for `preApplyStandards`. Pass `meta` to
   `runApply`. Pass `meta` to `writePending` (which forwards it to
   `buildPendingPayload`).
5. **Update `syncCommand`.** Same pattern: read once, pass `meta` to
   `runApply` and use the same instance in the prompt construction
   instead of calling `readRepoMeta` a second time.
6. **Test.** Add one direct test for the parameter wiring: identical
   result with and without `preReadMeta`. The existing 40 tests stay
   green; the apply write contract test still passes because no new
   files are touched.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **`preReadMeta` is stale by the time `runApply` writes the stamp.**
  Not applicable — the optional meta represents the snapshot before
  apply, which is exactly what every call site needs.
- **External caller passes the wrong `RepoMeta` shape.** The parameter
  is typed; TypeScript catches mismatches at compile time. At runtime,
  no extra validation is added — the existing `assertRepoMeta` runs in
  `readRepoMeta`, which is the entry point for the default behavior.
- **`buildPendingPayload` is called standalone (without `applyCommand`).**
  Backward-compatible: omit the optional parameter, default behavior
  unchanged.

## Acceptance criteria

- [x] `applyCommand` calls `readRepoMeta` exactly once per invocation;
      verified by code inspection of the resulting source.
- [x] `syncCommand` calls `readRepoMeta` exactly once per invocation.
- [x] `runApply(cwd, currentYear)` and `runApply(cwd, currentYear, meta)`
      produce identical `Change[]` results on the same fixture.
- [x] `buildPendingPayload(cwd, fromVersion)` and
      `buildPendingPayload(cwd, fromVersion, meta)` produce identical
      payloads on the same fixture.
- [x] `pnpm agent:check` passes, including the existing 40 tests and
      the new wiring test.

## Validation plan

- **Unit test:** assert that `runApply(cwd, year, meta)` returns the
  same `Change[]` as `runApply(cwd, year)` on the same fixture, using
  the existing fresh-repo fixture pattern.
- **Static inspection:** grep for `readRepoMeta(` across `src/` after
  the refactor — the count drops by 2 (was 4 across the apply/sync
  pipeline, becomes 2 plus the `safeReadRepoMeta`/agent reuse).
- **Self-check:** `pnpm check:self` stays green; no behavior change to
  the apply pipeline.

## Assumptions and open points

- **Verified:** `createContext`, `runApply`, `buildPendingPayload`,
  `writePending` are all internal to this package; no external dependent
  pinned to their current signatures.
- **Assumption:** the parallel refactors (plans 0004–0008) do not also
  rename `runApply` or `buildPendingPayload`. Merge conflicts on
  `src/cli.ts` and `src/sync.ts` may need manual resolution if plans
  0004, 0006, or 0007 land first.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    1 |
| Security        |        0 |         0 |    0 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    0 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    1 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** The optional parameter keeps backward
  compatibility and avoids promoting `SyncContext` across the public
  surface. If a future refactor decides to promote it, this is the
  natural step before it.
- **Testability — hint:** One direct equality test is enough; the
  existing apply-pipeline tests already cover the behavior.
- **Scope — hint:** `safeReadRepoMeta` (used in the `--force` flow of
  `initCommand`) is intentionally untouched — it serves a different
  purpose (best-effort pre-reset read).
- **Maintainability — hint:** Reduces the implicit assumption that
  `.repometa.json` does not change between back-to-back reads within a
  single command. Single read makes the snapshot semantics explicit.

## Test results

**Date:** 2026-06-18
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                              |
| ------------------------------------- | ----------------------------------- |
| oxlint + eslint                       | green, no warnings                  |
| oxfmt format:check                    | green                               |
| tsc (root + build)                    | green                               |
| vitest                                | 42/42 tests passed                  |
| `node dist/cli.js check` (self-check) | "Repository matches org standards." |

Two new tests in `describe("preReadMeta threading", ...)` lock in the
equivalence of parameterized and default runs for both `runApply` and
`buildPendingPayload`. The existing `writePending` tests are adjusted
because `writePending` now accepts a pre-built `PendingPayload` instead
of building one internally — the caller is responsible for that step.

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     0 |

Keine Findings gefunden. `writePending` was simplified rather than
gaining a fourth optional parameter (which would violate the project's
`max-params: 3` lint rule). The caller (`applyCommand`) now builds the
payload explicitly via `buildPendingPayload(cwd, fromVersion, meta)`
and passes the result to `writePending`. This is a minor semantic
adjustment compared to the plan but stays within the spirit of the
consolidation: one read, threaded through, no internal re-reads.
