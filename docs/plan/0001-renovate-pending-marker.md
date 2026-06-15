# 0001: Renovate-driven standards sync with pending marker (GitHub and Forgejo)

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

Standards updates across all managed repos should be initiated uniformly
through the already running self-hosted Renovate server. Renovate handles
both version detection (bump of `.repometa.json#standards`) and the
mechanical sync (`standards apply`). The judgement part is performed by
an externally triggered LLM agent (OpenClaw, local Claude Code, or
Codex) in pull mode. The agent deliberately does not run inside the
Renovate container so that auth tokens for the Claude MAX and Codex Pro
plans do not have to be persisted in a server environment.

Three hard constraints from the preceding conversation:

- No dedicated scheduler inside the target repos.
- No special-case handling for repos with `package.json`; all stacks
  treated alike.
- GitHub and private Forgejo instances are supported simultaneously.

Reason for the workflow recommendation: new CLI flags are added, a new
pending format is introduced, and a new Renovate server setup is
documented. That is new functionality — Feature, not Bugfix or
Refactoring.

## Architecture decisions

- **Two-layer model:** Renovate provides the mechanics plus a
  machine-readable pending marker. The LLM agent runs strictly externally
  in pull mode. Reason: decouples CI auth, lets us use flat-rate plans
  without ToS risk, allows mechanic-only PRs to merge immediately.
- **`.repometa.json#standards` remains the single source of truth.** No
  additional version file. Renovate bumps that value directly; the CLI
  command receives the old version via a flag because at execution time
  the file value is already overwritten. Reason: minimal state, no second
  notion of truth.
- **Pending file lives at `.standards/pending.json`.** Dedicated
  directory so lint/format rules can ignore it cleanly and so we have a
  clear namespace for future markers. Written only when judgement steps
  are pending.
- **Renovate server config is central, not per repo.** The custom
  manager, `postUpgradeTasks`, and `allowedCommands` live in the server
  configuration once.
- **`.repometa.json` is the per-repo opt-in — no second topic.** The
  existing server filters repos via `autodiscoverTopics: ["managed-deps"]`
  (proxmox Renovate server, its plan 0013). Standards updates do not
  introduce a second topic: the custom manager matches only in repos
  that have `.repometa.json`; repos without that file keep running as
  plain dep-update repos with no standards processing. Reason: the file
  must be present anyway for `standards apply` to work, so it is the
  better marker than a parallel topic that could drift.
- **`runApply` remains idempotent with respect to the stamp bump.** If
  Renovate has already bumped `.repometa.json`, `apply` does not
  re-write the same value. The current logic in `src/apply.ts` is
  already idempotent — this property must be preserved.
- **Stack detection is unchanged.** `detectScopes()` in `src/repo.ts`
  is already stack-agnostic via `manifest.json`. No code change
  required; the common scope always applies, other scopes only when
  the relevant marker files are present.
- **Stack-agnostic version model: integer stays authoritative,
  npm distribution is encapsulated.** Consumers must not see an
  npm/semver concept anywhere, including in the PR title. That rules
  out letting Renovate use the npm datasource directly, because then
  `{{newVersion}}` would yield the package semver (`0.3.0`) instead of
  the standards integer (`2`). Solution: the Renovate server runs a
  custom datasource that reads the standards repo's `manifest.json`
  and returns `manifest.currentVersion` as the sole release version.
  The custom manager binds this datasource instead of npm; both
  `currentValue` and `newVersion` are integers. The PR title remains
  `chore: standards v<N>` as defined in `SKILL.md`,
  `.repometa.json#standards` stays integer-typed, and no consumer repo
  sees a semver. `pnpm dlx` invocation remains a pure distribution
  detail of the Renovate worker.
- **`apply` write contract (binding promise).** `standards apply`
  writes only to:
  1. Paths declared in `manifest.json` as `managed.target` or
     `seeded.target` (for the scopes detected in the repo).
  2. Paths declared in `manifest.json` as `sections.file`, and there
     only inside the marker block boundaries.
  3. `.repometa.json` (only the `standards` field).
  4. The path passed via `--emit-pending <path>` plus any required
     parent directories.

  No other paths. This promise lets the Renovate server set a broad
  `fileFilters: ["**/*"]` without the risk of `apply` pulling
  unrelated repo content into the PR. Violations of the write contract
  are bugs in `standards apply`, not in the server config.

## Affected files

| File                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`                       | Flag parsing for `--from-version <int>` and `--emit-pending <path>` in the `apply` command. Routing in `applyCommand` so both values are passed on to `runApply` and to the pending emission.                                                                                                                                                                                                                                                                                                                                            |
| `src/apply.ts`                     | Extend `runApply` signature with an optional `fromVersion` parameter. After a successful apply, optionally write a pending payload. The stamp-bump logic stays unchanged so the Renovate pre-bump and the CLI run cooperate idempotently.                                                                                                                                                                                                                                                                                                |
| `src/sync.ts`                      | New internal helper that builds the pending payload (selects changes, builds the prompt, serializes). Reuses `selectChanges` from `src/changes.ts` and `buildPrompt` from `src/agent.ts`.                                                                                                                                                                                                                                                                                                                                                |
| `reference/node/oxfmtignore`       | Add `.standards/` so the generated pending file does not trigger formatting findings.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `reference/node/cspell.json`       | Add `.standards/` as an ignore path so cspell does not pick up the generated file.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `changes/0002-renovate-pending.md` | New changelog entry "Renovate as the single driver". Scopes: `common`. No mechanical steps in the target repo. No judgement steps in the target repo. Notes describe the pending model, the custom-datasource prerequisite on the Renovate server (integer from `manifest.json`), and the reminder that consumer tools outside the standards scopes (Prettier leftovers during migration, Biome, gitleaks, dependabot configs, semantic-release, etc.) must ignore `.standards/` themselves if they would otherwise scan all repo paths. |
| `test/apply.test.ts` _(new)_       | Tests for `--from-version` and `--emit-pending`: pending file is written on drift, stays absent on no-op, content matches today's `sync --dry-run` prompt.                                                                                                                                                                                                                                                                                                                                                                               |

The Renovate server configuration lives outside this repo and is not
part of the file table. It is described under "Approach" as reference
material.

## Implementation details

### Approach

1. **CLI flag parsing.** In `src/cli.ts`, add two helpers analogous to
   `getCwd`: `getFromVersion(args)` returns `number | undefined`,
   `getEmitPending(args)` returns a path or `undefined`. A hard error
   with a clear message on invalid input.
2. **Extend `runApply` signature.** Optional third parameter
   `fromVersion?: number`. When set, it is used only for the subsequent
   pending selection — the apply logic itself (managed, seeded,
   sections, stamp bump) stays unchanged.
3. **Pending emission.** After `runApply` inside `applyCommand` (not
   inside `runApply`, to keep the library path pure), check: if
   `--emit-pending` is set AND
   `selectChanges(packageRoot, fromVersion ?? meta.standards, scopeNames)`
   is non-empty, write the pending payload to `<path>`. Create parent
   directories as needed.
4. **Pending schema.** JSON object with fields: `schemaVersion: 1`,
   `fromVersion`, `toVersion`, `scopes`, `visibility`, `exceptions`,
   `prompt` (result of `buildPrompt`, identical to `sync --dry-run`),
   `changes` (array from `selectChanges` with `file`, `version`,
   `scopes`, `content`). Schema version explicit so future changes have
   a migration path.
5. **No-op behavior.** When no changelogs are pending, the pending file
   is not written; an existing file at the path is actively removed
   instead. That way the pull consumer can reliably filter on the mere
   presence of `.standards/pending.json`, even on rebase-capable
   branches: a stale marker from a previous Renovate run does not stay
   around just because this run's selection is empty. Renovate folds
   the delete commit into the PR automatically, so the PR diff stays
   consistent.
6. **Renovate server configuration (outside the repo, documented).**
   - **Custom datasource** `sebastian-software-standards` pulls
     `manifest.json` from the standards repo (stable raw URL, e.g.
     `https://raw.githubusercontent.com/sebastian-software/standards/main/manifest.json`)
     and maps `manifest.currentVersion` onto a single release version.
     The only version visible anywhere is an integer; the npm semver
     stays a distribution detail.
   - Custom manager with `customType: "regex"` reads
     `^\s*\"standards\":\s*(?<currentValue>\d+)` (multiline-anchored)
     from `^\.repometa\.json$`,
     `datasourceTemplate: "custom.sebastian-software-standards"`,
     `depNameTemplate: "standards"`,
     `versioningTemplate: "loose"` (integer comparison is well-defined
     under `loose`: `1 < 2 < 3`). The `^` anchor is mandatory so the
     match stays on top-level keys and future schema extensions with
     nested `"standards"` fields (e.g. `{ "data": { "standards": 7 } }`)
     are not picked up by mistake. Alternative for stricter JSON-path
     binding: `customType: "json"` with JSONPath `$.standards` —
     semantically clearer, but a different manager type; can be
     switched later without repo-side changes.
   - **PR title** `chore: standards v{{newVersion}}` yields integer
     values (`v2`, `v3`, …) instead of npm semver. Consistent with
     `SKILL.md`.
   - `postUpgradeTasks.commands`: a single entry
     `pnpm dlx @sebastian-software/standards apply --from-version {{currentValue}} --emit-pending .standards/pending.json`.
   - `executionMode: "branch"`, because `executionMode: "update"` has a
     known same-file problem.
   - `allowedCommands`: pin tightly to the exact command with regex
     anchors.
   - `fileFilters: ["**/*"]` covers both the files written by `apply`
     and the pending marker. Safe because `apply` honors the write
     contract documented above (see Architecture decisions).
   - One worker per PAT/bot identity. The existing server runs three
     workers, for example: GitHub-org PAT for `sebastian-software/*`,
     GitHub-user PAT for `Fastner/*` (with `autodiscoverFilter` so the
     user PAT does not accidentally touch org repos), and a Forgejo
     worker. The custom manager and the `postUpgradeTasks` block are
     identical in every worker config; only `platform`, `endpoint`,
     token, and possibly `autodiscoverFilter` differ.
   - No additional topic. Repos are still discovered through the
     existing `autodiscoverTopics: ["managed-deps"]` filter of the
     server. The custom manager matches only in repos with
     `.repometa.json`; repos without that file keep running as plain
     dep-update repos.
7. **Per-target-repo bootstrap (manual, one-off).**
   - The repo carries the existing `managed-deps` topic (prerequisite
     so the Renovate server scans it at all — unchanged from today's
     setup).
   - Create `.repometa.json` with
     `{ "standards": 0, "visibility": ..., "since": ... }`. That
     automatically activates the repo for standards updates; no second
     topic needed.
   - **Merge the onboarding PR.** The Renovate server runs with
     `requireConfig: "required"` and `onboarding: true`. On the first
     Renovate contact after the topic is set, Renovate opens an
     onboarding PR (typically `Configure Renovate`). While that PR is
     open the server delivers no real update PRs — including no
     standards PRs. Only after the merge do dep updates and the first
     standards PR appear in the next scan cycle.
8. **Write changelog `0002-renovate-pending.md`** to document the new
   model. Scope `common`. No mechanical or judgement steps in the
   target repo — the migration is the Renovate server setup, which
   the org owners do once.
9. **`SKILL.md` stays unchanged** on the PR title convention point
   (`chore: standards v<N>`). Thanks to the custom datasource Renovate
   provides an integer `{{newVersion}}`, so the Renovate PR title and a
   manual agent PR title are byte-identical without `SKILL.md` having
   to mention any npm/semver notion.

### State management

Not relevant — CLI tool with no runtime state outside the process.

### API integration

Not relevant — no HTTP APIs. Renovate reads the npm registry via its
own datasource mechanism; the standards package does not depend on it.

### Styling approach

Not relevant.

### Accessibility

Not relevant — server-side CLI.

### Edge cases

- **Renovate bumps `.repometa.json` before the CLI run.** Without
  `--from-version`, `selectChanges` would compare against the new
  version and return nothing. Solution: `--from-version` is mandatory in
  the Renovate config; the CLI fallback to the file value is reserved
  for local runs.
- **Repo has no `.repometa.json` yet.** `readRepoMeta` already throws
  today. Behavior preserved, surfaces in the server logs. Bootstrap is
  a deliberate manual step.
- **Repo has neither Node nor pnpm.** The Renovate container provides
  `pnpm dlx`; the target repo itself needs neither Node nor pnpm.
- **Pending file exists from a previous run on the same branch.**
  Renovate rebases; `apply` either overwrites the file
  deterministically or does not write it when no changes are pending.
  In the latter case a stale marker would linger. Mitigation: `apply`
  explicitly removes an existing `<emit-pending>` file when the change
  selection is empty.
- **Codex Pro vs. Claude MAX as pull consumer.** The plan does not
  decide that; the pending file is agent-neutral. The consumer picks.
- **Multiple stamp jumps in a single Renovate run** (e.g. from 1 to 3).
  `selectChanges` filters on `version > fromVersion` and returns all
  intermediate entries in ascending order. Behavior already exists and
  is locked in by a test.
- **Self-hosted Renovate without an `allowedCommands` entry.** Renovate
  silently skips `postUpgradeTasks` in that case. Explicitly documented
  in changelog `0002`.
- **Unmerged onboarding PR.** With `requireConfig: "required"` plus
  `onboarding: true`, the first contact only produces a
  `Configure Renovate` PR. Standards drift will not show up in the UI
  until that PR is merged. Mitigation: named explicitly as an
  onboarding step in changelog `0002`; negative expectation documented
  in the verification dry-run.
- **Foreign tools scan `.standards/`.** The standards package only
  maintains the Node-scope ignore lists (`oxfmtignore`, `cspell.json`).
  Repos with additional tools (Prettier leftovers during migration,
  Biome, gitleaks, dependabot configs, semantic-release pipelines,
  custom lint scripts, etc.) that scan all paths must exclude
  `.standards/` themselves. Mitigation: explicitly mentioned as a notes
  bullet in changelog `0002` so repo owners account for it during
  onboarding.
- **Token without write permission on all paths.** If the worker token
  (e.g. GitHub user PAT with limited scope, Forgejo app token without
  repo-write) lacks write permission on one of the paths touched by
  `apply`, the commit step after `postUpgradeTasks` fails silently:
  Renovate either treats the result as "no effective diff" or logs a
  push error without opening a PR. Mitigation: explicitly stated as a
  server-operator requirement in the assumptions; first run per worker
  observed via logs.
- **Forgejo driver: parity with GitHub not guaranteed.** The Renovate
  Forgejo driver supports `postUpgradeTasks` per the docs, but
  experience shows that label setting and some PR metadata are less
  reliable than on the GitHub driver. Concrete impact on this plan:
  the planned label `standards:needs-agent` may not be set on Forgejo.
  The pull consumer (OpenClaw / local Claude Code) must therefore not
  filter exclusively on the label but also look for the presence of
  `.standards/pending.json` in the PR diff. This file-based fallback is
  the primary filter; the label is only an optimization. Verified
  explicitly in the validation plan (Forgejo dry-run).

## Acceptance criteria

- [ ] `standards apply --from-version <int>` is available; invalid
      values fail with a clear error message.
- [ ] `standards apply --emit-pending <path>` writes a file with the
      defined schema when `selectChanges` is non-empty.
- [ ] On an empty selection with a file already at the path, the file is
      removed; otherwise no file is created.
- [ ] The pending `prompt` is byte-identical to `standards sync --dry-run`
      for the same input state.
- [ ] `runApply` remains idempotent against `.repometa.json#standards`,
      even when the value has already been bumped manually to
      `manifest.currentVersion`.
- [ ] `pnpm agent:check` passes, including the new tests.
- [ ] **Write contract verified:** a test runs `apply` on a fixture
      containing files outside the four contractually allowed path
      categories and asserts via file-hash snapshot that only the
      allowed paths were modified or newly created.
- [ ] Changelog `changes/0002-renovate-pending.md` exists, scope
      `common`, describes the Renovate setup and names the pending path.
- [ ] `.standards/` is added to `reference/node/oxfmtignore` and
      `reference/node/cspell.json`.
- [ ] `SKILL.md` keeps the integer convention `chore: standards v<N>`
      unchanged; no npm/semver concept in the agent prompt.

## Validation plan

- **Unit tests (`vitest`):**
  - `runApply` with a set `fromVersion` selects changes against that
    value, not against the already-bumped `.repometa.json`.
  - Pending emission writes the schema; the `fromVersion`, `toVersion`,
    `scopes`, `prompt`, and `changes` fields are checked against
    fixtures.
  - No-op case: no file is written; an existing file is removed.
  - **Write contract:** fixture repo with foreign files (`src/x.ts`,
    `.gitignore`, `README.md` without branding marker, etc.); after
    `apply` only the four contractually allowed path categories are
    modified. Verified by hash snapshot of all other files.
- **Integration smoke:** `node dist/cli.js apply --from-version 0 --emit-pending /tmp/pending.json --cwd <fixture-repo>`
  on a fixture (pure common scope, no `package.json`) verifies stack
  agnosticism.
- **Self-check:** `pnpm check:self` (runs the compiled CLI against the
  own repo) must stay green.
- **Renovate dry run (manual, outside CI):** self-hosted Renovate with
  `--dry-run=full` against a Forgejo test repo and a GitHub test repo,
  each with `.repometa.json` and the existing `managed-deps` topic.
  Expected: the custom manager finds the value, `postUpgradeTasks`
  appears in the log, and the PR contains a rendered pending file on
  drift.
- **Negative test:** a repo with the `managed-deps` topic but without
  `.repometa.json`. Expected: regular dep-update PRs, no standards PR,
  no `postUpgradeTasks` execution.

## Assumptions and open points

- **Verified:** self-hosted Renovate is already in production on both
  platforms and uses `autodiscoverTopics: ["managed-deps"]` as the repo
  filter (proxmox Renovate server, its plan 0013). Repos for standards
  updates must remain in the `managed-deps` topic; the additional
  per-repo opt-in is solely the presence of `.repometa.json`.
- **Assumption:** `pnpm dlx` is available inside the Renovate container
  (true for the default Renovate image with Node toolchain).
- **Requirement on the server operator:** the Renovate token (PAT or
  bot identity) for every worker needs write permission on all paths
  that `standards apply` touches in the consumer repo — that is, all
  managed/seeded targets from `manifest.json`, the branding section
  files, `.repometa.json`, and the path passed via `--emit-pending`
  (`.standards/pending.json`). In practice that means standard
  write permission on the repo is enough; specific branch protection
  rules must not exclude the Renovate bot. Otherwise the commit step
  after `postUpgradeTasks` fails silently — Renovate logs the error
  but does not open a PR. Mitigation: run an initial dry run (see
  validation plan) on every platform and observe logs during the first
  real run.
- **Verified:** `pnpm dlx` caches per worker, not per server. The
  Renovate container has a per-worker cache bind mount (proxmox
  Renovate server, its plan 0013). With three workers,
  `@sebastian-software/standards` is therefore downloaded up to three
  times per cache window. Functionally irrelevant; only relevant for
  network budget or registry rate limits. A central pre-install (e.g.
  `pnpm add -g`) in the Renovate image is explicitly out of scope for
  this plan.
- **Assumption:** OpenClaw and local Claude Code workflows can read a
  PR with `.standards/pending.json` and update the branch. Concrete
  integration steps for OpenClaw are not part of this plan.
- **Open:** whether label setting by Renovate should be conditional on
  the presence of the pending file (complex in the Renovate config) or
  always applied with the pull consumer cleaning up. Current stance:
  always set, pull consumer cleans up. On Forgejo, additionally expect
  that the label may not be set at all (see the "Forgejo driver" edge
  case); the file-based filter (`.standards/pending.json`) is therefore
  the primary detection path, with the label only an optimization.
  Final decision will be made on the Renovate server config; not a
  blocker for the CLI work.
- **Open:** auto-merge for purely mechanical PRs (no pending) is
  recommended but not part of this plan.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    5 |
| Security        |        0 |         1 |    1 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         1 |    1 |
| Testability     |        0 |         0 |    0 |
| Scope           |        0 |         0 |    1 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Security — important:** The `allowedCommands` entry on the Renovate
  server must be pinned tightly to the exact command. Otherwise
  manipulated `.repometa.json` values (e.g. `currentValue = 1; rm -rf /`)
  could reach the shell executor. Adjustment: in the approach,
  explicitly use the regex with `\d+` and a path literal, and keep
  `allowShellExecutorForPostUpgradeCommands: false` (default) — without
  shell semantics, arguments are passed safely. Already captured in
  step 6.
- **Failure modes — important:** Stale pending file on rebase-capable
  branches. Adjustment: `apply` removes the file explicitly on an empty
  selection. Already captured in step 5 and the edge cases.
- **Security — hint:** Token permissions are a hard requirement on the
  server operator. Without write permission on all paths touched by
  `apply`, the commit step fails silently. Explicitly named as a
  "server operator requirement" in the assumptions and documented as a
  failure mode in the edge cases.
- **Architecture — hint:** `runApply` deliberately stays library-pure
  (no file emit). Pending writing lives in `applyCommand` — better
  testability, clearer layering.
- **Scope — hint:** The Renovate server setup is part of the plan but
  not part of the repo. The server config is referenced from
  `changes/0002` so org owners can trace it.
- **Architecture — hint:** Per-repo opt-in is solely the presence of
  `.repometa.json`; a second topic next to the existing `managed-deps`
  is intentionally not introduced to avoid topic drift.
- **Maintainability — hint:** `schemaVersion: 1` in the pending format
  is the entry point for future format migrations without breaking
  consumers.
- **Failure modes — hint:** The Forgejo driver has known weaknesses in
  label setting and PR metadata. The plan addresses this through a
  file-based primary filter (`.standards/pending.json`); the label is
  only an optimization. Captured in the validation plan and the edge
  cases.
- **Architecture — hint:** The `apply` write contract (four fixed path
  categories) is stated explicitly in the architecture decisions,
  protected by an acceptance criterion, and verified by a unit test.
  That makes broad `fileFilters: ["**/*"]` safe on the server side.
- **Architecture — hint:** The version model stays stack-agnostic.
  Instead of the npm datasource (which would put a semver in
  `{{newVersion}}`), the Renovate server uses a custom datasource on
  `manifest.json#currentVersion`, so `{{newVersion}}` is an integer.
  The PR title `chore: standards v<N>` and `.repometa.json#standards`
  stay integer-typed; Rust and doc-only repos see no npm/semver
  concept. `SKILL.md` is unchanged.
- **Architecture — hint:** The custom-manager regex is anchored at line
  start with `^`, so future schema extensions with nested `"standards"`
  occurrences remain collision-free. JSON path is documented as an
  alternative but deliberately not used initially.

## Test results

**Date:** 2026-06-15
**Validator:** `pnpm agent:check` (final run green)

| Gate                                  | Status                                  |
| ------------------------------------- | --------------------------------------- |
| oxlint + eslint                       | green, no warnings (`--max-warnings=0`) |
| oxfmt format:check                    | green, 45 files                         |
| tsc (root + build)                    | green                                   |
| vitest                                | 18/18 tests passed                      |
| `node dist/cli.js check` (self-check) | "Repository matches org standards."     |

**New tests:**

- `selectChanges` and `buildPrompt` updated for two active changelogs
  (0001 + 0002), with explicit version comparisons.
- `buildPendingPayload`: three tests (schema-compliant emission, no-op
  at the current stamp, explicit `fromVersion` overrides a bumped
  `.repometa.json`).
- `writePending`: three tests (writes the marker at the resolved path,
  removes a stale marker on no-op, no file on no-op without an
  existing file).
- `apply write contract`: one test with foreign files (`src/x.ts`,
  `.gitignore`, `docs/notes.md`), verifies via file-hash snapshot that
  only contract paths are modified.

## Review findings

**Date:** 2026-06-15
**Reviewer:** sf-frontend-workflows:nodejs-reviewer

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     7 |
| Open / Not implemented |     6 |

**Resolved in this workflow:** F1 (plan consistency for no-op), F6
(control-char sanitization via `JSON.stringify`), F7 (strict integer
validation with `/^\d+$/u`), F9 (`writePending` tests cover the contract
path implicitly), F10 (direct tests for no-op delete behavior and
default baseline), F11 (`writePending` moved into `sync.ts` and
exported), F12 (`getFlagValue` helper guards the next argument and
prevents flag swallowing).

**External review report:**
`.sf-plugin/review/review-report-2026-06-15-plan-0001.md`
(six open hints, all complexity Easy, all follow-up work: empty
`.standards/` directory after deletion, duplicate `detectScopes` call,
symlink edge case, repeated `readRepoMeta` calls, encoding consistency
for `writeFileSync`, `assertPendingPayload` guard for consumers).
