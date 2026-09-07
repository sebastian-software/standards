# 0017: CLI and stamp alignment, and a marker for unvalidated agent runs

**Plan status:** Implemented
**Source:** https://github.com/sebastian-software/standards/issues/75
**Recommended workflow:** Feature

## Requirement

Two coupled outcomes, delivered as one change.

**(A) Prove CLI/stamp alignment instead of inferring it.** `standards check`
already compared `.repometa.json#standards` against the running CLI's
`manifest.json#currentVersion`, and `getPackageRoot()` already resolved the
installed package under both `pnpm exec` and `pnpm dlx`. The defect was not a
missing comparison. It was that the comparison was symmetric, non-blocking,
silently reversible by `apply`, and unreachable in the failing population: a
consumer pinned to an old release runs a CLI whose manifest is old too, and no
validation shipped in a later release ever executes there. The fix has to reach
the consumer through artifacts a fresh CLI writes, not only through code in a
future release.

**(B) Separate publication from validated completion.** The always-push policy
from #37 and the information comment from #40 stay intact: the agent still
commits, pushes and removes `.standards/pending.json`. What changes is that an
unvalidated result now leaves a machine-checkable trace.

## Architecture decisions

Four decisions were fixed by the maintainer during planning and are not
revisited here.

- **The `runApply` downgrade guard fires only when `--from-version` was absent.**
  An unconditional guard collides with the documented Renovate flow: Renovate
  raises `.repometa.json#standards` before the unpinned `dlx` CLI runs, and that
  CLI may legitimately be older. With an unconditional guard `selectChanges`
  would return empty, `writePending` would delete the marker, and the pull
  request would be permanently red with no agent trigger. `--from-version` is
  the reliable discriminator: Renovate always passes it, a human or agent
  invoking a stale pinned CLI directly does not.
- **`.standards/blocked.json` is written whenever any gate check remains failing
  or incomplete**, matching #75's third criterion literally rather than only the
  alignment case. It carries a `blocking` flag that is true only for the
  CLI/stamp alignment class, and CI hard-fails only on `blocking: true`. Red
  lint, type, test and build lanes already fail CI on their own and are recorded
  as context, not duplicated as a second failure source.
- **`cliVersion` is additive; `schemaVersion` stays `1`.** Nothing in this
  package reads a payload back at runtime — `assertPendingPayload` is exercised
  only by the test suite — so a schema bump plus a "fails closed" promise would
  have described unreachable behaviour. The only real reader is the external
  OpenClaw wiring, which makes coordination an explicit `SKILL.md` deliverable
  instead of a claimed guarantee.
- **`standards check` exits `3` for a blocking finding, `1` for non-blocking
  only, `0` when clean; `2` stays reserved for usage errors.** `--json` alone
  would have left the seeded CI, which calls `standards check` without it, unable
  to distinguish the classes without a parser.

Further decisions taken during implementation:

- **`cliVersion` is read from the CLI's own `package.json#version`**, not
  published as a new `manifest.json` field. npm always ships `package.json`, and
  `package.json#files` already ships `manifest.json`, so no `release-please`
  `extra-files` entry is needed.
- **The alignment obligation anchors on two independent values.** `cliVersion`
  alone cannot distinguish a `dlx`-fresh payload from one a stale local
  `apply --emit-pending` produced, so the prompt also requires the installed
  `manifest.json#currentVersion` to equal `pending.json#toVersion`.
  Compatibility is never inferred from npm semver ordering.
- **The pre-flight instruction is conditioned on `ChangesSource`.**
  `buildPrompt` serves both the fresh `dlx` CLI and `syncCommand`'s possibly
  stale local CLI. An unconditional "raise the pin to `cliVersion`" would tell an
  inline run to pin to the version it already has.
- **The seeded alignment step uses `node -p` and `require.resolve`**, not `jq`
  (not guaranteed in the Forgejo node image) and not a fixed `node_modules/`
  path (nested workspaces per change 0012). It sits immediately before the
  `standards check` step rather than ahead of every lane, so other failures stay
  visible to a reviewer. The blocked-marker step uses plain `grep`, needs neither
  `jq` nor `node_modules`, and therefore lands in the rust reference too.
- **`changes/0013` carries an explicit judgement step for the CI workflows.**
  Both node workflows are seeded, not managed, and `applySeeded` returns early
  when the target exists, so `standards apply` alone never delivers the new steps
  to a repository that already has a `ci.yml`.

## Affected files

| File                                  | Description                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/check.ts`                        | `Finding.blocking`; directional stamp finding, blocking in the CLI-behind direction                       |
| `src/cli.ts`                          | `--json` writer, exit codes 0/1/3, usage text, `--from-version` threaded into `runApply`                  |
| `src/apply.ts`                        | `ApplyOptions` bag; downgrade guard scoped to invocations without `--from-version`                        |
| `src/sync.ts`                         | `PendingPayload.cliVersion`, populated by `buildPendingPayload`, validated when present                   |
| `src/manifest.ts`                     | `loadCliVersion` reads the running CLI's own `package.json#version`                                       |
| `src/blocked.ts`                      | New: `BlockedState` and `assertBlockedState`, the authoritative schema definition                         |
| `src/agent.ts`                        | Corrected context header, per-`ChangesSource` pre-flight, extended `## Validation` block                  |
| `SKILL.md`                            | Corrected pin guidance, run-1 contract, blocked-marker schema, ownership table, external-wiring follow-up |
| `reference/node/*-workflows-ci.yml`   | Alignment guard before the drift lane; blocked-marker guard after the pending guard                       |
| `reference/rust/ci.yml`               | Blocked-marker guard after the pending guard                                                              |
| `changes/0013-cli-stamp-alignment.md` | New migration entry, scopes `node, rust`                                                                  |
| `manifest.json`, `.repometa.json`     | Standards version 13, self-stamp 13                                                                       |
| `test/standards.test.ts`              | New coverage plus updates to the hard-coded version lists                                                 |

## Implementation details

### Approach

1. `Finding` gains `blocking: boolean`. Its doc comment states that exactly one
   finding is blocking — the stamp mismatch in the direction
   `manifest.currentVersion < meta.standards` — and that everything else,
   including the missing-platform stamp finding, is non-blocking.
2. The stamp check moves into a `stampFinding` helper that returns different
   text per direction. The CLI-behind message names the required action: raise
   the pin, refresh the lockfile.
3. `checkCommand` splits into a JSON writer and a prose writer plus a
   `checkExitCode` helper. `--json` emits the object and nothing else, the
   zero-findings case included.
4. `runApply`'s third parameter becomes an `ApplyOptions` bag carrying both
   `preReadMeta` and the new `explicitFromVersion` signal. The bag was forced by
   the repository's own `max-params` lint rule, which caps a function at three
   parameters; the three call sites that passed `preReadMeta` positionally were
   updated.
5. `buildPendingPayload` reads `loadCliVersion(getPackageRoot())` and passes it
   both into the payload and into `buildPrompt`.
6. `assertBlockedState` validates the marker in three groups (header, versions,
   tail) to stay inside the repository's function-size limits.
7. `SKILL.md`'s workflow step 1 replaces the false claim that a CLI older than
   the stamp "reports drift that does not exist" with the two directions, their
   exit codes, and the two-value verification rule.

### Edge cases

- **Repository behind a newer CLI** (the normal Renovate flow): non-blocking
  finding, exit 1, `apply` bumps the stamp, nothing new fires.
- **Renovate raised the stamp, the resolved `dlx` CLI is older**:
  `--from-version` is present, so `apply` self-heals the stamp downwards exactly
  as before and the pull request stays green.
- **Stale pinned CLI runs `apply` directly, without `--from-version`**: the guard
  fires, the stamp is preserved, `check` exits 3, CI fails, the agent writes
  `blocked.json`.
- **Bump with no judgement entries for the repository's scopes**:
  `selectChanges` is empty, `buildPendingPayload` returns `undefined` and
  `writePending` deletes the marker. No agent runs, which is safe because `apply`
  ran with `--from-version` and self-healed the stamp.
- **Nested workspaces**: the alignment step resolves the manifest through
  `require.resolve` over the root plus every directory in
  `.repometa.json#workspaces`.
- **Equal versions**: no finding, exit 0, `blocked.json` deleted if present.
- **Agent cannot raise the pin**: it still pushes its best-effort commits and
  writes `blocked.json` with `blocking: true` and that reason.
- **Non-alignment checks red**: `blocked.json` is written with `blocking: false`
  listing them; the marker step passes and the repository's own lanes fail the
  pull request.
- **`blocked.json` present from an earlier run, current run clean**: the agent
  deletes it. The marker never triggers a run on its own, so no retry loop.
- **Repository without `.standards/`**: the agent creates the directory.
  `.standards/` is excluded from formatting and spell checking, and `apply` only
  ever unlinks the `--emit-pending` path, so it never manages the marker.
- **Legacy platform block**: `blockedByLegacyPlatform` keeps precedence over the
  new downgrade guard; both suppress the bump.

## Acceptance criteria

- [x] `PendingPayload` gains `cliVersion: string`, populated by
      `buildPendingPayload` and validated by `assertPendingPayload` when present;
      `schemaVersion` stays `1`.
- [x] `Finding` gains `blocking: boolean`; exactly one finding is blocking, and
      the type's doc comment says so.
- [x] The stamp finding text is directional, and the CLI-behind message names
      the required action.
- [x] `standards check --json` writes one object with `findings`, `total` and
      `blocking`, emits no prose including the zero-findings case, and bypasses
      the `✓` branch.
- [x] `standards check` exits `3` for a blocking finding, `1` for non-blocking
      only, `0` when clean; `2` stays reserved for usage errors; the usage text
      is updated.
- [x] `runApply` leaves the stamp untouched when the CLI is behind the repository
      and no `--from-version` was supplied; the self-healing path is unchanged;
      `blockedByLegacyPlatform` keeps precedence.
- [x] `buildPrompt` no longer claims the stamp is up to date, names the producing
      CLI version in `pending-file` mode, and omits the instruction in `inline`
      mode.
- [x] The `## Validation` block instructs the agent to write and clear
      `.standards/blocked.json` and keeps the "never withhold or revert your
      commits" rule verbatim.
- [x] The blocked-marker schema is documented in `SKILL.md` and defined once in
      `src/blocked.ts`.
- [x] Both seeded node workflows gain the `node -p` alignment step immediately
      before `standards check`.
- [x] All three seeded workflows gain the `.standards/blocked.json` step.
- [x] `SKILL.md` mirrors the run-1 contract, documents the marker, corrects the
      pin guidance, adds the ownership table, and records the external-wiring
      follow-up.
- [x] `changes/0013-cli-stamp-alignment.md` exists with `- **Scopes:** node, rust`,
      a mechanical section and the two judgement steps.
- [x] `manifest.json#currentVersion` and `.repometa.json#standards` are both 13.
- [x] Regression tests cover every case named in the plan.
- [x] `pnpm agent:check` passes.

## Validation plan

- `pnpm test` for the unit and reference-file coverage.
- `pnpm agent:check` as the final gate, including `check:self`, which is why the
  self-stamp had to move to 13 alongside `manifest.json#currentVersion`.
- The exit-code assertions run the built `dist/cli.js` as a subprocess, so the
  published entry point is what is exercised rather than the library function.

## Test results

- `pnpm test` — 184 tests passed across 3 files.
- `pnpm agent:check` — passed: lint (oxlint and eslint), format check, typecheck,
  build, tests, and self `standards check`.

## Assumptions and open items

- **Verified:** the CLI-behind case is writable today by stamping a fixture at
  `manifest.currentVersion + 1`, since `runCheck` only compares two integers. The
  injectable-package-root seam considered during planning was dropped: a fake
  root would break `readReference`, `selectChanges` and `buildPrompt`.
- **Verified:** `assertPendingPayload` has no production read caller; the only
  real reader is the external wiring.
- **Coordination item, outside this repository:** the Renovate
  `postUpgradeTasks` invocation must gain `--config.minimum-release-age=0`.
  Without it pnpm 11 resolves a release up to 24 hours old and `cliVersion`
  records a lagging version. Recorded in `SKILL.md`'s external-wiring follow-up.
- **Accepted residual risk:** deleting `.standards/blocked.json` is the cheapest
  way to a green pipeline, the same failure class #75 reports for
  `pending.json`. The independent backstop is the seeded alignment step, which
  lives in a file the consumer owns. This repository cannot enforce consumer-side
  branch content.
- The marker is named `.standards/blocked.json`; `SKILL.md`'s reservation of
  `.standards/review-pending.json` for run 2 is left untouched.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Note |
| --------------- | -------: | --------: | ---: |
| Architecture    |        2 |         0 |    1 |
| Security        |        0 |         0 |    0 |
| Data protection |        0 |         0 |    0 |
| Error cases     |        0 |         4 |    0 |
| Testability     |        0 |         1 |    0 |
| Scope           |        0 |         2 |    1 |
| Maintainability |        0 |         1 |    5 |

### Findings

- **Architecture, Critical — resolved by decision.** An unconditional downgrade
  guard collides with the Renovate flow and would leave the pull request
  permanently red with no agent trigger. The guard is scoped to invocations
  without `--from-version`.
- **Architecture, Critical — incorporated.** Both CI workflows are seeded, not
  managed, so `standards apply` would never deliver the new guards to a
  repository that already has a `ci.yml`. `changes/0013` carries an explicit
  judgement step that merges both steps into an existing workflow.
- **Architecture, Note — accepted residual risk.** Marker deletion is
  unenforceable from this side; the seeded alignment step is the backstop.
- **Error cases, Important — incorporated.** `runApply` rewrote the stamp in both
  directions, erasing the evidence of a mismatch. Now guarded.
- **Error cases, Important — incorporated.** The `postUpgradeTasks` command
  needs `--config.minimum-release-age=0`, or `cliVersion` records a lagging
  version.
- **Error cases, Important — resolved by decision.** `schemaVersion: 2` plus a
  "fails closed" promise described unreachable behaviour. `cliVersion` is
  additive and the coordination is an explicit `SKILL.md` deliverable.
- **Error cases, Important — incorporated.** The pin instruction is conditioned
  on `ChangesSource`, so a stale inline run is not told to pin to itself.
- **Testability, Important — corrected.** Relative fixture stamps make both
  directions testable without an injectable package root.
- **Scope, Important — resolved by decision.** The marker is written for every
  failing or incomplete gate check and carries a `blocking` flag; CI hard-fails
  only on the alignment class.
- **Scope, Important — incorporated.** #75's fourth criterion became an
  ownership table plus a follow-up record in `SKILL.md`.
- **Scope, Note — incorporated.** The rust reference receives the blocked-marker
  step, which needs no `node_modules`.
- **Maintainability, Important — resolved by decision.** Exit code `3` lets the
  seeded CI discriminate without a parser.
- **Maintainability, Notes — incorporated.** `Finding.blocking` is defined for
  every kind; `--json` key names, the zero-findings case and the `✓` interaction
  are fixed; the alignment step uses `node -p` and `require.resolve` and sits
  immediately before the drift lane.

## Open Points

- No open points.

## Review-Findings

**Date:** 2026-09-07
**Reviewer:** self-review

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Fixed                  |     1 |
| Open / Not implemented |     0 |

### Findings

- **Fixed — `runApply` signature.** The plan described threading the new signal
  as a fourth positional parameter. The repository's `max-params` lint rule caps
  a function at three, so `preReadMeta` and `explicitFromVersion` were folded
  into one `ApplyOptions` bag. The three call sites that passed `preReadMeta`
  positionally were updated; no behaviour changed.
