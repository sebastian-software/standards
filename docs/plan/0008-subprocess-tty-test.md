# 0008: Subprocess-based test for the CLI non-TTY guard

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

The CLI's "no TTY and no `--yes`" guard in `initCommand` is verified
today only by inspection and by the unit-level test that exercises
`runInit`'s library-pure guard. The actual process boundary — what
happens when a user pipes input or runs the CLI from a non-interactive
shell — is not covered. The plan adds a subprocess test that invokes
the built `dist/cli.js` with stdin piped (so `isTTY` is `undefined`)
and asserts non-zero exit plus the documented "No TTY" hint on stderr.

This is additive test coverage with no production-code change. The
workflow is Feature because it introduces a new test mode (subprocess
spawning of the built CLI) that other future CLI tests may build on.

## Architecture decisions

- **Spawn the built binary, not the TypeScript source.** Use
  `node dist/cli.js` to verify the same artifact the package publishes.
  Consistent with the existing `bin wrapper starts with a node shebang`
  test, which already inspects `bin/standards.js`.
- **Use `process.execPath` rather than `node`.** Stable across
  environments where `node` on PATH might be a different version than
  the one running vitest.
- **Rely on `agent:check` ordering.** `pnpm agent:check` runs
  `pnpm build` before `pnpm test`, so `dist/cli.js` always exists when
  the subprocess test runs. No build inside the test.
- **Drive stdin as an empty pipe.** `input: ""` plus
  `stdio: ["pipe", "pipe", "pipe"]` produces `isTTY === undefined` on
  the child's stdin, which is exactly the condition the guard targets.

## Affected files

| File                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/standards.test.ts` | New `describe("standards init CLI guard", ...)` block. The test spawns `process.execPath` with `["<package-root>/dist/cli.js", "init", "--cwd", fixtureCwd]`, sets `input: ""`, and asserts non-zero exit plus stderr matches `/No TTY/`. The fixture is created with `mkdtempSync` and contains no `.repometa.json`. The test imports `getPackageRoot` from `../src/manifest.js` to locate the built CLI deterministically. |

## Implementation details

### Approach

1. **Locate the built CLI** with `path.join(getPackageRoot(), "dist", "cli.js")`. `getPackageRoot` is already used elsewhere in the test file (`describe("published binary", ...)`), so the import path is established.
2. **Spawn with empty stdin pipe.** `spawnSync(process.execPath, [cliPath, "init", "--cwd", fixtureCwd], { input: "", stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" })`. Passing `input: ""` makes stdin a non-TTY pipe that closes immediately.
3. **Assert** `result.status !== 0` and `result.stderr.match(/No TTY/)`.
4. **Fixture cleanup.** Use a fresh `mkdtempSync(join(tmpdir(), "standards-cli-"))` for the working directory. No `.repometa.json` is written to it, so the test does not depend on any prior state. No teardown needed — temp directories are OS-managed.
5. **No changes to production code.** The test is purely additive.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **`dist/cli.js` missing.** Fails fast with a clear node error from
  the spawned process. `agent:check` runs `pnpm build` before
  `pnpm test`, so this is not an issue in the standard validation
  flow. A developer running `pnpm test` directly without a prior build
  would see the failure as a missing-module error from the child
  process — acceptable for an opt-in workflow.
- **`process.execPath` differs from the published node version on a
  user's machine.** Not a concern for this repo's CI; the test is
  about CLI behavior under the current node, not cross-version
  compatibility.
- **Windows runners.** Not in scope; the repo's CI is Linux/macOS only.
- **Test takes longer than unit tests.** Subprocess spawn adds tens of
  milliseconds. Acceptable as a single test; if the pattern grows, a
  dedicated `describe` block keeps the cost bounded.
- **Stderr capture format differences.** `encoding: "utf8"` ensures
  the assertion sees a string; no buffer-to-string conversion in the
  assertion.

## Acceptance criteria

- [x] A new test spawns `node dist/cli.js init --cwd <fixture>` with
      `input: ""` and asserts non-zero exit.
- [x] The test asserts that stderr contains the `"No TTY"` substring.
- [x] `pnpm agent:check` passes.
- [x] The fixture directory is created via `mkdtempSync`; no leftover
      state pollutes other tests.
- [x] No production-code file in `src/` is modified.

## Validation plan

- **New vitest test:** runs as part of the standard `pnpm test`
  invocation.
- **Self-check:** `pnpm check:self` stays green; the new test does not
  affect the standards check itself.
- **Manual smoke (optional):** in an interactive terminal,
  `node dist/cli.js init` still drops into prompts (no regression).

## Assumptions and open points

- **Verified:** `pnpm agent:check` runs `pnpm build` before `pnpm test`
  (see `package.json#scripts.agent:check`), so `dist/cli.js` exists
  when the subprocess test runs.
- **Verified:** `getPackageRoot` is already imported in
  `test/standards.test.ts` (the existing `published binary` test uses
  it), so the new test reuses the same import.
- **Assumption:** parallel plans (0003, 0004, 0005, 0006, 0007) do not
  also add a `describe("standards init CLI guard", ...)` block. Plans
  0005, 0006, and 0007 also touch `test/standards.test.ts` but in
  separate describe blocks; merge conflict potential is limited to
  import-order adjustments.

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
| Maintainability |        0 |         0 |    0 |

### Findings

- **Architecture — hint:** The pattern (spawn the built binary with a
  controlled stdin) matches the existing `published binary` smoke
  test's intent and locates the artifact via the same helper.
- **Failure modes — hint:** Test asserts both exit code and stderr
  content so a future change that silently swallows the error message
  would still fail the assertion.
- **Testability — hint:** This is the canonical way to verify CLI-level
  behavior at the process boundary, complementing the unit-level
  `runInit` guard tests already in place.
- **Scope — hint:** Limited to the non-TTY guard; broader CLI smoke
  tests are out of scope for this PR but could grow later under the
  same describe block.

## Test results

**Date:** 2026-06-18
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                              |
| ------------------------------------- | ----------------------------------- |
| oxlint + eslint                       | green, no warnings                  |
| oxfmt format:check                    | green                               |
| tsc (root + build)                    | green                               |
| vitest                                | 41/41 tests passed                  |
| `node dist/cli.js check` (self-check) | "Repository matches org standards." |

One new test under `describe("standards init CLI guard", ...)` spawns
the built CLI with piped stdin and asserts non-zero exit plus the
`/No TTY/` marker on stderr.

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review (test-only addition)

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     0 |

Keine Findings gefunden. Single subprocess assertion against the
existing CLI guard; no production code changed, no shared helpers
touched.
