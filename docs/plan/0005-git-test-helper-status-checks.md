# 0005: Assert git command success in the `initGitRepo` test helper

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Refactoring (`/refactor`)

## Requirement

`initGitRepo` in `test/standards.test.ts` invokes `spawnSync` four times
(`git init`, `writeFileSync` README, `git add`, `git commit`) without
checking exit status. A silently failing git step — for example because
the CI image lacks git, because `--initial-branch` is unsupported on
older git versions, or because the back-dated commit format gets
rejected by a future git release — would surface as a confusing
expectation failure several lines later instead of a clear root-cause
message.

The plan adds explicit status assertions, so any failure in the test
setup is reported at its source. No production-code change.

## Architecture decisions

- **Wrap `spawnSync` in a small helper instead of inlining
  `expect(result.status).toBe(0)` after every call.** The helper keeps
  the test body readable and produces a single, descriptive error
  message that names the failed git step and includes stderr.
- **Apply the helper inside `initGitRepo` only.** Other `spawnSync`
  uses in `test/standards.test.ts` (the `published binary` shebang
  check) already check what they need; expanding the helper's reach is
  scope creep.
- **No new dependencies.** The helper is a few lines of TypeScript
  using `node:child_process` and `vitest`'s assertion library only.

## Affected files

| File                     | Description                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/standards.test.ts` | Add `runGit(cwd, args, env?)` helper that runs `spawnSync("git", ...)` with `stdio: ["ignore", "pipe", "pipe"]`, asserts `status === 0`, and throws a clear error with the git step name and captured stderr otherwise. Use it inside `initGitRepo` for the three git invocations. The `writeFileSync` for `README.md` stays as-is — it is not a `spawnSync` call. |

## Implementation details

### Approach

1. **Define `runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv)`** near the existing test helpers
   (`createFreshDir`, `initGitRepo`, `hashTree`, `readStamp`, `unwrap`).
2. **Inside the helper**: call `spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })`. If `result.status !== 0` or `result.error !== undefined`, throw an `Error` whose message names the args and includes `result.stderr?.trim()` for diagnostic context.
3. **Replace the three `spawnSync` calls inside `initGitRepo`** with calls to `runGit`. The `writeFileSync` for `README.md` between `git init` and `git add` stays unchanged.
4. **No new test case** is required; the helper exists to make existing tests fail faster and clearer on setup errors. The behavior on a successful setup is unchanged.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **`git` binary missing on PATH.** `result.error` is set; the helper
  throws with the git step name. Beats today's behavior, where the
  later assertion fails with a misleading message about the commit
  year.
- **`--initial-branch` flag unsupported.** Older git versions ignore or
  reject it. The helper throws with stderr quoted, naming the step.
- **Future git versions reject the back-dated date format.** Same path —
  helper throws with stderr included.
- **Existing tests that exercise `initGitRepo` happy path.** They still
  pass; only the failure mode is improved.

## Acceptance criteria

- [x] `initGitRepo` uses a status-asserting helper for every git
      invocation.
- [x] If `git` is unavailable or any git step exits non-zero, the test
      fails at the failed step with a message that includes the
      command and the captured stderr.
- [x] All existing tests that depend on `initGitRepo` (the
      `detectFirstCommitYear` happy path test and the `runInit` git
      year test) keep passing.
- [x] `pnpm agent:check` passes.

## Validation plan

- **Unit-test sanity:** run the existing tests; they must stay green
  because the helper is a stricter form of the existing setup.
- **Manual failure-mode check (optional):** temporarily rename `git` on
  PATH and observe that the test fails with the new helper's message
  instead of the previous "expected 2020 to be undefined" form.

## Assumptions and open points

- **Verified:** the existing tests rely on git being available in the
  environment running the suite; CI already has git installed.
- **Assumption:** parallel plans (0003, 0004, 0006, 0007, 0008) do not
  edit `initGitRepo` or the surrounding helpers. Plans 0007 and 0008
  also touch `test/standards.test.ts` but in separate describe blocks;
  merge conflict potential is low.

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

- **Architecture — hint:** The helper is local to the test file; no
  global test infrastructure is introduced.
- **Failure modes — hint:** Improvement is specifically about
  surfacing setup failures clearly. No new failure modes introduced.
- **Testability — hint:** This is a test-quality change; no production
  code is involved.
- **Scope — hint:** Only the three git invocations inside
  `initGitRepo` are touched; other `spawnSync` uses remain unchanged.

## Test results

**Date:** 2026-06-18
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                              |
| ------------------------------------- | ----------------------------------- |
| oxlint + eslint                       | green, no warnings                  |
| oxfmt format:check                    | green                               |
| tsc (root + build)                    | green                               |
| vitest                                | 40/40 tests passed                  |
| `node dist/cli.js check` (self-check) | "Repository matches org standards." |

`initGitRepo` now goes through the new `runGit` helper, which throws on
non-zero exit with the failing arguments and captured stderr in the
message. The two tests that depend on `initGitRepo`
(`detectFirstCommitYear` happy path, `runInit` git-year default) still
pass.

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review (test-only change)

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     0 |

Keine Findings gefunden. Test-internal helper with no production-code
impact; the validator gates and the two existing dependent tests
already cover the regression surface.
