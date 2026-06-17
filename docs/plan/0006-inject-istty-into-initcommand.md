# 0006: Inject `isTty` parameter into `initCommand`

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Refactoring (`/refactor`)

## Requirement

`initCommand` reads `process.stdin.isTTY` directly, so neither branch of
the TTY guard is reachable from a vitest unit test without spawning a
subprocess. The plan injects the value as an explicit parameter:
`main()` reads it once from `process.stdin.isTTY` and passes it through,
unit tests pass it directly.

This is a structural change with no behavior change at runtime; the
recommended workflow is Refactoring.

## Architecture decisions

- **Add an explicit `isTty` parameter, not a global toggle.** Matches
  the existing pattern of CLI arguments being explicit dependencies.
- **`main()` is the only call site that touches the global.** A single
  read at the entry point is consistent with the existing CLI structure
  and keeps the test-friendly seam at the smallest unit.
- **`initCommand` keeps its boolean semantics.** No re-encoding into a
  three-state enum; `true | false` is sufficient because the existing
  fail-fast path only branches on TTY-or-not.
- **No public API exposed.** `initCommand` is not exported, so the
  signature change is internal.

## Affected files

| File                     | Description                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`             | `initCommand(cwd, currentYear, args, isTty)`. `main()` reads `process.stdin.isTTY` once and passes a boolean (defaulting `undefined` → `false`).                                                   |
| `test/standards.test.ts` | Add two `initCommand`-level tests: TTY=true uses prompts, TTY=false without `--yes` throws the expected `InitError`. Both tests rely on the existing fixture infrastructure; no subprocess needed. |

## Implementation details

### Approach

1. **Update `initCommand` signature.** Add `isTty: boolean` as the
   fourth parameter. Drop the direct `process.stdin.isTTY` read inside
   the function.
2. **Update the call from `main()`.** `main()` computes
   `const isTty = process.stdin.isTTY === true` (kept simple to avoid
   the `boolean | undefined` widening that the lint config previously
   complained about) and passes it as the fourth argument. The pattern
   matches the existing `cwd`/`currentYear` injection.
3. **Internal behavior unchanged.** The two guard branches and the
   `options.interactive` decision use `isTty` exactly as today.
4. **Export `initCommand` for testing.** Add `export` so vitest can
   call it directly. Confirmed by inspection — `initCommand` is not
   currently exported, but exporting it does not widen the public CLI
   API because the package's `exports` map is at the binary level.
5. **Tests.** Two short tests:
   - `initCommand(cwd, year, ["--yes"], false)` succeeds (non-TTY
     path with `--yes`).
   - `initCommand(cwd, year, [], false)` throws `InitError` with the
     "No TTY available" message.
     Both use a fresh fixture directory created by the existing
     `createFreshDir` helper.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **TTY guard fires before `getVisibilityFlag`/`getSinceFlag` validation.**
  Order of validation is unchanged: arg parsing still happens before the
  TTY guard, so invalid `--visibility` or `--since` values surface
  before the TTY check whether stdin is a TTY or not.
- **`process.stdin.isTTY` is `undefined` on some non-interactive
  shells.** `main()` coerces with `=== true` so the parameter is always
  a strict `boolean`. Same effective behavior as today.
- **`runInit`'s own library-pure TTY guard remains.** Even though
  `initCommand` now injects `isTty`, `runInit`'s `guardLibraryUsage`
  still protects direct library callers who pass `interactive: true`
  without custom streams.

## Acceptance criteria

- [x] `initCommand` signature is `(cwd, currentYear, args, isTty)` and
      no longer reads `process.stdin.isTTY` directly.
- [x] `main()` is the sole reader of `process.stdin.isTTY` in
      `src/cli.ts`.
- [x] A new vitest test drives the TTY=false / no `--yes` branch and
      asserts the expected `InitError` message — without using
      `spawnSync`.
- [x] A new vitest test drives the TTY=true happy path with `--yes`
      and asserts a written `.repometa.json`.
- [x] `pnpm agent:check` passes.

## Validation plan

- **Unit tests** (new): the non-TTY branch without `--yes` throws
  `InitError`; the TTY branch with `--yes` writes the file.
- **Self-check:** `pnpm check:self` stays green.
- **Manual smoke (optional):** `node dist/cli.js init` in an interactive
  terminal still drops into prompts; with stdin piped, still errors
  fast.

## Assumptions and open points

- **Verified:** `initCommand` is currently a module-internal function;
  exporting it does not widen the public CLI surface, which is
  binary-level (`bin/standards.js`).
- **Assumption:** parallel plans do not also change `initCommand`'s
  signature. Plan 0008 (subprocess TTY test) extends test coverage but
  does not touch `initCommand` directly; potential merge conflict on
  `test/standards.test.ts` is in different describe blocks and easy to
  resolve.

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
| Maintainability |        0 |         0 |    0 |

### Findings

- **Architecture — hint:** The pattern (entry point reads global,
  everything else takes it as a parameter) matches the existing CLI
  structure for `cwd` and `currentYear`.
- **Testability — hint:** Two unit tests cover both branches with no
  subprocess overhead.
- **Scope — hint:** The change is limited to `initCommand` even though
  other CLI subcommands could plausibly benefit later — sticking to
  the smallest unit minimizes blast radius for this PR.

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

Two new tests under `describe("initCommand TTY injection", ...)` drive
both branches without spawning a subprocess: non-TTY without `--yes`
throws `InitError` containing `"No TTY"`; non-TTY with `--yes` plus
flag values writes `.repometa.json`.

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     1 |

**Hint (carried into follow-up):** importing `src/cli.ts` from tests
fires the top-level `await main()` block once (prints USAGE because
`process.argv` contains no command). The stdout noise is cosmetic; the
test gate still reports green because vitest does not act on
`process.exitCode`. A future cleanup could gate `main()` on an explicit
entry-point check, but that requires `bin/standards.js` to import a
named `main` export instead of side-effect-importing the module.
