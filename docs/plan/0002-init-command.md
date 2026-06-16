# 0002: Interactive `standards init` command to bootstrap `.repometa.json`

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

Bootstrapping a managed repo today requires hand-writing `.repometa.json`
with `standards`, `visibility`, and `since`. The plan introduces an
`init` subcommand that turns this into a guided, low-effort step:
running `pnpm dlx @sebastian-software/standards init` in a fresh repo
prompts for the needed fields and writes a complete file. A
non-interactive mode via flags covers CI and scripted bootstrap.

Reason for the workflow recommendation: this is a new user-facing CLI
subcommand with new dispatch, prompts, validation, and tests. That is
clearly new functionality — Feature, not Bugfix or Refactoring.

Quick correction to the request as phrased: the published package is
`@sebastian-software/standards` (not `@sebastian-gmbh/standards`), and
the current pnpm shortcut for one-off invocations is
`pnpm dlx @sebastian-software/standards init` (`pnpx` was deprecated in
favor of `pnpm dlx`).

## Architecture decisions

- **Zero new runtime dependencies.** Use `node:readline/promises` from
  the standard library for prompts. Keeps the package small and
  preserves today's "no runtime dependencies" stance. Two fields are
  too few to justify a prompts library.
- **Both interactive and non-interactive modes.** Flags
  (`--visibility`, `--since`, `--yes`) cover headless CI; interactive
  prompts remain the default when a TTY is available. Tests can
  exercise the flag path without mocking `readline`.
- **Refuse if `.repometa.json` exists unless `--force` is set.** Safer
  default. The error message names both `standards apply` (for updates)
  and `--force` (for a deliberate reset). This avoids silent
  overwrites of hand-edited files.
- **`init` only writes the file.** No automatic `apply`. The user (or
  Renovate) decides when to run apply. Single responsibility, simpler
  error handling.
- **`standards: 0` is hard-coded.** init always seeds at version 0 so
  the next `apply` (or Renovate-driven update) walks every changelog
  from the start. No flag for this; it keeps intent unambiguous and
  the schema small.
- **Interactive visibility prompt uses single-letter shortcuts.**
  Instead of asking the user to type `oss` or `private` in full, the
  prompt offers a two-line menu and accepts either the short letter
  (`o`/`p`) or the long form (`oss`/`private`). Empty input keeps the
  default. The `--visibility` flag still requires the long form
  (`oss`/`private`) so scripts stay self-documenting. Reason: minimum
  typing in the common interactive path without losing clarity in
  scripted CI invocations.
- **`since` default is derived from the repo when possible.** If `cwd`
  is inside a git working tree with at least one commit, the default
  is the year of the first commit (root commit). Otherwise the default
  is `currentYear`. Reason: most repos have a longer history than the
  day they get standards-managed, so the copyright range
  (`copyrightYears(since, currentYear)`) reflects the real range
  automatically. The user can still override interactively or via
  `--since`. Any git failure (not a repo, no commits, git binary
  missing, slow call) silently falls back to `currentYear` — no error
  surface added for an optional convenience.
- **Library-pure entry point `runInit`.** Mirrors the
  `runApply`/`runCheck` pattern already in `src/`. CLI wiring lives in
  `src/cli.ts`; the I/O-heavy core lives in a new `src/init.ts`
  module so it can be tested directly with vitest.
- **Reuse `writeRepoMeta` and `REPO_META_FILE`** from `src/repo.ts:44`
  and `src/repo.ts:6`. No new serialization, no path duplication.

## Affected files

| File                               | Description                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/init.ts` _(new)_              | New module exporting `runInit(cwd, currentYear, options)`. Handles existence guard, value resolution from flags/prompts, validation, and the `writeRepoMeta` call. Exports a typed `InitOptions` record.                                                                                 |
| `src/cli.ts`                       | New `init` case in the dispatch switch. New `initCommand(cwd, currentYear, args)`. New flag helpers `getVisibility(args)`, `getSince(args)`, `getYes(args)`, `getForce(args)` following the existing `getFlagValue` pattern. USAGE text extended with the `init` line and its flag list. |
| `src/repo.ts`                      | No change. Existing `writeRepoMeta`, `REPO_META_FILE`, and `RepoMeta` type are reused.                                                                                                                                                                                                   |
| `test/standards.test.ts`           | New `describe("runInit", ...)` block covering: fresh dir writes the schema, refuses on existing file, `force` overrides, defaults applied, invalid visibility/since rejected, validation messages.                                                                                       |
| `README.md`                        | One-line addition to the CLI section documenting `standards init` and its main flags.                                                                                                                                                                                                    |
| `changes/0002-renovate-pending.md` | Notes bullet on the bootstrap step updated to recommend `pnpm dlx @sebastian-software/standards init` instead of hand-writing the file.                                                                                                                                                  |

## Implementation details

### Approach

1. **New `src/init.ts` module.** Exports `runInit(cwd, currentYear, options): Promise<RepoMeta>`. Options are an object with `visibility?`, `since?`, `force?`, `interactive?` plus implicit defaults. Returns the written meta on success; throws on validation or guard failures.

2. **Existence guard.** At the top of `runInit`, check whether `.repometa.json` already exists in `cwd`. If yes and `!force`, throw a typed error with a multi-line message: "`.repometa.json` already exists. Use `standards apply` to update or `standards init --force` to reset."

3. **Default resolution.** Before prompting or applying flags, compute
   the effective defaults:
   - `visibilityDefault = "oss"`.
   - `sinceDefault = detectFirstCommitYear(cwd) ?? currentYear`.
     `detectFirstCommitYear` runs `git -C <cwd> log --reverse --format=%cs --max-parents=0` with a short timeout (e.g. 2 s) via `node:child_process`, parses the leading 4-digit year of the first line, validates it against the same `[2000, currentYear + 1]` sanity range, and returns `undefined` on any failure (non-zero exit, empty output, missing git binary, parse failure, range failure).

4. **Value resolution.** For each field:
   - if the option was passed via flag, use it as-is (after validation),
   - else if `interactive` and a TTY is available, prompt for it (default value shown in brackets is the resolved default from step 3),
   - else apply the resolved default.

5. **Interactive prompts (`node:readline/promises`).** Two prompts:
   - Visibility: a two-line menu with single-letter shortcuts:

     ```
     Repository visibility:
       (o) open source — public, marketing footer
       (p) private — internal, plain copyright
     Choice [o]:
     ```

     Accepted inputs (case-insensitive, trimmed): `o`/`oss` → `"oss"`, `p`/`private` → `"private"`, empty → default. Anything else re-prompts up to N retries with a one-line hint listing the accepted inputs.

   - Since: `Initial year [${sinceDefault}]:` — empty input keeps default; non-integer or out-of-range value re-prompts. The default shown reflects the git detection result (e.g. `[2020]` in a long-lived repo, `[2026]` in a fresh directory).

6. **Validation.**
   - `visibility ∈ {"oss", "private"}`.
   - `since` is an integer in `[2000, currentYear + 1]` — a sanity range that catches typos like `20226` without being overly strict.
   - These rules live in `src/init.ts` and are applied uniformly to flag-supplied and prompt-supplied values.

7. **Write.** `writeRepoMeta(cwd, { standards: 0, visibility, since })` produces the file at `.repometa.json`. The `standards: 0` is fixed.

8. **CLI dispatch in `src/cli.ts`.** Add `case "init":` calling `initCommand(cwd, currentYear, rest)`. `initCommand` parses flags, decides between interactive and non-interactive, calls `runInit`, and prints a one-line confirmation (e.g. `Wrote .repometa.json (standards=0, visibility=oss, since=2026)`).

9. **USAGE text.** Add the `init` line under `apply`/`sync` with the flag list `[--visibility oss|private] [--since <int>] [--yes] [--force]`.

10. **Tests in `test/standards.test.ts`.**
    - Happy path with all flags set: `--yes --visibility private --since 2024` writes the expected JSON byte-for-byte (flag overrides any detected git year).
    - Default path with `--yes` only on a non-git directory: writes `{ standards: 0, visibility: "oss", since: currentYear }`.
    - Default path with `--yes` only on a git working tree with a backdated first commit (e.g. `GIT_AUTHOR_DATE=2020-01-01 git commit ...`): writes `since: 2020`.
    - Git detection failure modes (missing binary, no commits, parse failure): default falls back to `currentYear`. Tested by pointing `detectFirstCommitYear` at a fixture without `.git/`.
    - Refuses on existing file without `force`; error message names both `apply` and `--force`.
    - Accepts `--force` and overwrites.
    - Rejects invalid `--visibility` (e.g. `internal`) with a clear error.
    - Rejects out-of-range `--since` (e.g. `1999`, `99999`).
    - Visibility prompt parser accepts `o`, `O`, `oss`, `OSS`, `p`, `private`, `oss`, empty (uses default); rejects `internal`, `1`, `yes`.
    - All interactive-path tests exercise `runInit` directly with options pre-filled to avoid mocking `readline` — only one targeted unit test for the prompt loop itself, using a piped writable/readable stream.

### State management

Not relevant — CLI tool without runtime state beyond the process.

### API integration

Not relevant — no HTTP APIs.

### Styling approach

Not relevant.

### Accessibility

Not relevant — server-side CLI. Interactive prompts respect `stdin`/`stdout`; a non-TTY environment combined with `--yes` produces the same result without hanging.

### Edge cases

- **`.repometa.json` exists, no `--force`.** Throws with the actionable error message above; nothing is written.
- **`.repometa.json` exists, `--force` set.** Overwrites silently after one stdout line stating the previous values for traceability (e.g. `Resetting .repometa.json (was: standards=2, visibility=oss, since=2024)`).
- **Non-TTY stdin without `--yes`.** `process.stdin.isTTY` is `undefined`. Prompts would hang. `initCommand` detects this and throws with the hint: "No TTY available; pass `--yes` (with flags as needed) for non-interactive mode."
- **Invalid `--visibility` value.** Clear error listing the valid values (`oss`, `private`). The flag deliberately rejects short forms like `o`/`p`, so script callers see explicit values in their history.
- **Interactive shortcut vs. flag.** Single-letter shortcuts (`o`/`p`) are accepted only at the interactive prompt; if a user passes `--visibility o`, the flag validator rejects it.
- **Invalid `--since` value.** Clear error stating the accepted range (`2000–${currentYear + 1}`).
- **User aborts (Ctrl-C).** `readline/promises` propagates the abort; the CLI exits with a non-zero code. Because the file is written only after all prompts validate, no partial state remains on disk.
- **`--yes` without other flags.** Uses defaults (visibility=`oss`, since=`currentYear`). This is the "sensible bootstrap" path for scripts.
- **`--yes` combined with flags.** Flags take precedence over defaults; both modes are non-interactive.
- **Repo without `package.json`.** Irrelevant — `init` does not look at scopes. Same flow on Rust- or doc-only repos.
- **Not a git repo.** `detectFirstCommitYear` returns `undefined`; the `since` default becomes `currentYear`. No error surfaced.
- **Git repo without any commit yet.** `git log` returns empty; `detectFirstCommitYear` returns `undefined`; fallback to `currentYear`.
- **Git binary missing on PATH.** `child_process` spawn fails; `detectFirstCommitYear` returns `undefined`; fallback to `currentYear`.
- **Git command exceeds timeout.** Treated like a failure; fallback to `currentYear`. Prevents a hung git invocation from blocking the prompt.
- **First-commit year outside the sanity range.** Treated like a failure (defensive — covers spoofed timestamps or filesystem clock skew); fallback to `currentYear`.
- **User overrides the git-derived default.** Interactive prompt or `--since` flag wins over the detected value. No warning needed.

## Acceptance criteria

- [ ] `standards init` opens interactive prompts when a TTY is available and writes a complete `.repometa.json` with `standards: 0`.
- [ ] `standards init --yes` writes the file non-interactively with defaults: `visibility: "oss"` and `since` taken from the git root-commit year if available, otherwise `currentYear`.
- [ ] `standards init --visibility private --since 2024 --yes` writes the file with the provided values.
- [ ] `standards init` aborts with a clear error when `.repometa.json` already exists; the error names both `standards apply` and `--force`.
- [ ] `standards init --force` overwrites an existing file and emits a one-line `Resetting …` notice.
- [ ] Invalid values for `--visibility` or `--since` are rejected with a clear, actionable error. Flag rejects short forms (`o`/`p`); only long forms (`oss`/`private`) are valid for the flag.
- [ ] Interactive visibility prompt accepts both short forms (`o`/`p`) and long forms (`oss`/`private`), case-insensitive, and applies the default on empty input.
- [ ] Non-TTY stdin without `--yes` fails fast with a hint instead of hanging.
- [ ] In a git working tree with a backdated root commit, the prompt default and the non-interactive default for `since` match the year of the root commit.
- [ ] In a non-git directory or in a git repo without commits or with `git` missing, the `since` default silently falls back to `currentYear` (no error logged).
- [ ] No new runtime dependency is added to `package.json`.
- [ ] `pnpm agent:check` passes, including the new tests.

## Validation plan

- **Unit tests (`vitest`):**
  - Fresh directory + full flags → file matches the expected JSON.
  - Fresh non-git directory + `--yes` only → defaults applied (`visibility: "oss"`, `since: currentYear`).
  - Fresh git working tree with a root commit dated 2020 + `--yes` only → `since: 2020`.
  - Git detection edge cases (no commits, missing `.git/`, simulated spawn failure) → `since` falls back to `currentYear`.
  - Existing file + no force → throws; message names `apply` and `--force`.
  - Existing file + `--force` → overwrites; previous values logged.
  - Invalid `--visibility` → rejected.
  - Out-of-range `--since` → rejected.
  - Targeted prompt-loop test that drives `runInit` with simulated `Readable`/`Writable` streams for stdin/stdout to exercise the interactive code path without a TTY.
- **Integration smoke (manual):** `node dist/cli.js init --cwd /tmp/fresh-repo --yes --visibility private --since 2024` writes the expected file.
- **Self-check:** `pnpm check:self` stays green — this repo's `.repometa.json` is not touched by `init` because the existence guard refuses to overwrite it.

## Assumptions and open points

- **Verified:** `node:readline/promises` is available since Node 18; the package requires Node 24+ per `package.json#engines`. No polyfill or fallback needed.
- **Verified:** the current CLI follows the pattern of small library functions (`runApply`, `runCheck`) wrapped by command functions in `src/cli.ts`. `runInit` follows the same convention.
- **Assumption:** `git` is typically available where `pnpm dlx @sebastian-software/standards init` would be run. If it is not, `detectFirstCommitYear` returns `undefined` and the `currentYear` fallback applies — the feature degrades silently rather than failing.
- **Assumption:** stdin/stdout streams are usable for the targeted prompt-loop test via `node:stream`. If not, the test is downgraded to a unit test of the parsing helpers and a manual interactive smoke test is recorded.
- **Open:** whether to surface the post-init suggestion `Run \`standards apply\` next` as a one-line stdout hint. Default in this plan: yes, as the closing message — same line where the file is reported as written.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    2 |
| Security        |        0 |         0 |    0 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    2 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    1 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** `init` deliberately mirrors `apply` and `check`: a small `runInit` library function in `src/init.ts`, plus a thin CLI wrapper in `src/cli.ts`. Keeps the public CLI surface uniform.
- **Architecture — hint:** Reusing `writeRepoMeta` and `REPO_META_FILE` avoids drift between init and the rest of the CLI. No duplicate JSON serialization, no duplicate path logic.
- **Failure modes — hint:** Non-TTY stdin without `--yes` is caught explicitly and produces an actionable error rather than hanging — the most common headless-CI mistake.
- **Failure modes — hint:** `--force` logs the previous values before overwriting, giving the user a tiny audit trail even when they triggered the reset themselves.
- **Testability — hint:** Most tests exercise `runInit` with options pre-filled (no `readline` mocking). One targeted test uses piped streams for the interactive code path, keeping the readline coverage minimal but real.
- **Scope — hint:** `init` does not chain into `apply`. Composability is documented by suggesting `standards apply` as the next step in the closing stdout line.
- **Maintainability — hint:** Zero new runtime dependencies means `init` will not become a maintenance burden if the prompts UX needs to change later.

## Test results

**Date:** 2026-06-16
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                                  |
| ------------------------------------- | --------------------------------------- |
| oxlint + eslint                       | green, no warnings (`--max-warnings=0`) |
| oxfmt format:check                    | green, 47 files                         |
| tsc (root + build)                    | green                                   |
| vitest                                | 40/40 tests passed                      |
| `node dist/cli.js check` (self-check) | "Repository matches org standards."     |

**New tests:**

- `parseVisibilityFlag` and `parseVisibilityChoice` cover long and short forms, case-insensitive prompt accepts, flag-only rejection of short forms.
- `parseSinceFlag` covers happy path, leading-zero rejection, out-of-range bounds, the inclusive `currentYear + 1` upper bound, and the `--since:` flag-prefix on errors.
- `detectFirstCommitYear` happy path with a backdated git repo, plus three failure modes (non-git directory, no commits, missing binary).
- `runInit` happy paths (full options, defaults, git-derived since), existence guard with and without `--force`, write contract assertion (only `.repometa.json` modified).
- `runInit interactive prompt loop` six tests: shortcuts accepted, defaults on empty input, re-prompt after invalid visibility / invalid year (prompt-style message without `--since` vocabulary), abort after three invalid attempts in each prompt.

## Review findings

**Date:** 2026-06-16
**Reviewer:** sf-frontend-workflows:nodejs-reviewer

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |    11 |
| Open / Not implemented |    13 |

**Resolved in this workflow:**

- F2/F6 (strict 4-digit year regex, no leading zeros)
- F3/F24 (prompt-style error messages, separate `parseSinceValue` helper)
- F4 (re-prompt and retry-limit tests added)
- F8 (`Reset .repometa.json (was: ...)` audit line restored per plan)
- F9 (boundary test for `currentYear + 1`)
- F11 (`terminal` mode chosen automatically based on TTY context)
- F16 (test feed helper refactored to sequential `setImmediate` with awaitable promises)
- F17 (`runInit` guards interactive mode against non-TTY `DEFAULT_STREAMS`)
- F20 (`Readable`/`Writable` types from `node:stream` instead of `NodeJS.*` globals)
- F23 (write-contract test verifies only `.repometa.json` is touched)

**External review report:** `.sf-plugin/review/review-report-2026-06-16-plan-0002.md` (13 open follow-ups: one important on exit-code consistency, twelve hints across atomic writes, empty-directory cleanup, type guards, subprocess-based TTY tests, and several carried-over items from plan 0001).
