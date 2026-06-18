# 0009: Platform-aware manifest, CLI, and GitHub Actions CI seed (standards v3)

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

Standards rollout cannot reach a green CI state in consumer repos
without a CI gate. Forgejo support is the next platform after GitHub,
so the CI infrastructure is built platform-aware from the start: a
`platform` field on `.repometa.json` and an optional `platform` field
per manifest entry. With that scaffolding in place, the first
application — a GitHub Actions CI workflow — ships as a `seeded` entry,
and a future Forgejo CI seed becomes a "one reference file + one
manifest entry" follow-up (tracked separately in `#10`).

This standards bump goes to version 3 and ships changelog 0003 with
both the platform migration step (set `platform` in `.repometa.json`)
and the GitHub Actions seed.

Workflow recommendation Feature: new schema field on `RepoMeta`, new
manifest field, new filter logic in `apply`/`check`, new CLI flag plus
init prompt, new reference file, new changelog, new tests. Substantial
new functionality — not a refactor, not a bugfix.

## Architecture decisions

- **`RepoMeta.platform` is optional at the schema level, required in
  practice for new repos.** Legacy repos created before this change
  may have no `platform` field; `readRepoMeta` must tolerate that so
  `apply --emit-pending` can deliver the 0003 migration step. `init`
  writes `platform` unconditionally going forward.
- **Filter contract is explicit and symmetric across `apply` and
  `check`.** For each entry (managed / seeded / sections):
  - `entry.platform === undefined` → applies to every repo.
  - `entry.platform !== undefined && meta.platform === undefined` →
    skipped (legacy fallback; the changelog migration tells the user
    to set platform and re-run).
  - `entry.platform === meta.platform` → applies.
  - `entry.platform !== meta.platform` → skipped.
- **Platform default detection is heuristic, not authoritative.** `init`
  runs `git remote get-url origin`; the URL containing `github.com` →
  `github`, every other case (other host, missing remote, error) →
  `forgejo`. The user can override at the prompt or via `--platform`.
- **Interactive platform prompt mirrors the visibility prompt.**
  Single-letter shortcuts `(g)` / `(f)` plus long forms `github` /
  `forgejo`, case-insensitive, default shown in brackets matches the
  detected value. Same parser style as `parseVisibilityChoice` from
  `src/init.ts`.
- **`--platform` flag (long form only) follows the same asymmetry as
  `--visibility`.** Flag rejects short forms; interactive prompt
  accepts both. Keeps scripts self-documenting.
- **No new pending-marker mechanism for legacy repos.** The 0003
  changelog entry — written by `buildPendingPayload` whenever the repo
  stamp is older than the manifest version — is the migration
  delivery channel. The Renovate / agent workflow already consumes
  `.standards/pending.json`; no parallel marker file is introduced.
- **Self-repo bumps itself in the same PR.** `.repometa.json` for this
  repo gets `platform: "github"` and `standards: 3`. The
  `check:self` step keeps the package honest about its own
  invariants.
- **Manifest schema is loosened, not versioned separately.**
  `FileMapping.platform?` and `SectionSpec.platform?` are new optional
  fields. No bump of the manifest file format itself; the runtime
  `assertManifest` check stays lax (current style — only
  `currentVersion` + `scopes` are required at parse time). New tests
  cover the filter behaviour, not the JSON shape.

## Affected files

| File                                     | Description                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/repo.ts`                            | New `Platform` type (`"github" \| "forgejo"`). `RepoMeta` gains optional `platform?: Platform`. `assertRepoMeta` validates the field when present. Exported `isPlatform` type guard for reuse.                                                                                                  |
| `src/manifest.ts`                        | `FileMapping` and `SectionSpec` gain optional `platform?: Platform` (imported from `src/repo.ts`). `assertManifest` stays lax — no new structural check. Type-level field is enough for downstream filtering.                                                                                   |
| `src/apply.ts`                           | `applyManaged`, `applySeeded`, and `applySections` filter entries via a shared `matchesPlatform(entryPlatform, metaPlatform)` helper before doing any work. No platform filter on the stamp bump. No new error surface for legacy repos — they simply skip platform-scoped entries.             |
| `src/check.ts`                           | `checkManaged`, `checkSeeded`, and `checkSections` apply the same filter. Filtered-out entries do not contribute to drift findings.                                                                                                                                                             |
| `src/init.ts`                            | New `parsePlatformFlag` / `parsePlatformChoice` helpers (mirror of the visibility helpers). New `detectPlatform(cwd)` that runs `git remote get-url origin` with the existing `GIT_TIMEOUT_MS`. Prompt loop gains a third question for platform. `InitOptions.platform` added.                  |
| `src/cli.ts`                             | `getPlatformFlag(args)` helper. `initCommand` reads `--platform` and passes it through.                                                                                                                                                                                                         |
| `manifest.json`                          | Add seeded entry to `node` scope: `{ source: "reference/node/github-workflows-ci.yml", target: ".github/workflows/ci.yml", platform: "github" }`. Bump `currentVersion` to `3`.                                                                                                                 |
| `reference/node/github-workflows-ci.yml` | New seed file. Triggers `pull_request` and `push: { branches: [main] }`. Pipeline as documented under "Implementation details → CI seed".                                                                                                                                                       |
| `.repometa.json`                         | Self-stamp gets `platform: "github"` and `standards: 3`.                                                                                                                                                                                                                                        |
| `changes/0003-platform-aware-ci.md`      | New changelog entry. Scopes: `common`, `node`. Notes the `platform` field as a one-shot migration for legacy repos (judgement step: run `standards init --force --platform <p>`) and the GitHub Actions CI seed. Forgejo follow-up referenced as `#10`.                                         |
| `test/standards.test.ts`                 | New `platform filter` describe block covering the four combinations (github-scoped on github / on forgejo / forgejo-scoped on github / on forgejo) plus universal-entry behaviour. Updates to `runInit` tests to reflect the new optional `platform` flag and the prompt loop's third question. |
| `README.md`                              | One-line addition under "How it works" stamp example to mention `platform`. Same place that already shows `{ "standards": 1, "visibility": "oss", "since": 2026 }`.                                                                                                                             |
| `SKILL.md`                               | New rule bullet: "Respect `platform`." (entries without `platform` apply everywhere; entries with `platform` apply only on matching repos). One sentence; the existing Renovate-onboarding and merge-policy structure remains untouched.                                                        |

`bin/standards.js` and `src/sync.ts` need no change; `runInit`'s
`InitOptions.platform` rides through the existing `streams` /
`interactive` plumbing, and `buildPendingPayload` already serializes
`meta` as-is — the new optional field is included automatically when
present.

## Implementation details

### Approach

1. **Add the `Platform` type and extend `RepoMeta`.** `src/repo.ts`
   exports `Platform = "github" | "forgejo"`, a small `isPlatform`
   type guard, and `RepoMeta` gains `platform?: Platform`.
   `assertRepoMeta` checks the field only when present.
2. **Extend `manifest.ts` types.** `FileMapping.platform?` and
   `SectionSpec.platform?` (no runtime validation change — the lax
   `assertManifest` style is consistent with `currentVersion` /
   `scopes` only).
3. **Introduce the filter helper.** Either in `src/sync.ts`
   alongside the existing `SyncContext` (it already centralises
   meta + manifest access) or as a local helper in both
   `apply.ts` and `check.ts`. Pick whichever keeps each module
   under the lint complexity ceiling. The function shape:
   `matchesPlatform(entryPlatform: Platform | undefined, metaPlatform: Platform | undefined): boolean`.
4. **Wire the filter into `apply.ts` and `check.ts`.** Each of
   `applyManaged` / `applySeeded` / `applySections` (and the
   `check` counterparts) prepends a `.filter(matchesPlatform(...))`
   step. The stamp bump path is unaffected.
5. **Extend `init.ts`.**
   - New `detectPlatform(cwd)` runs `spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: GIT_TIMEOUT_MS, encoding: "utf8" })`; on success, return `"github"` if stdout contains `github.com`, else `"forgejo"`; on any failure or empty stdout, return `"forgejo"`.
   - New `parsePlatformFlag(raw)` accepts only `"github"` / `"forgejo"` (throws `InitError` otherwise).
   - New `parsePlatformChoice(raw)` accepts `g` / `github` / `f` / `forgejo`, case-insensitive, trimmed; returns `undefined` for unrelated input.
   - `InitOptions` gains optional `platform`.
   - The prompt loop in `resolveInteractive` gains a third question after `since`. Same retry-3 contract as the visibility prompt. Default shown in brackets is the detected platform from step 1.
   - The non-interactive path (`runInit` with `interactive: false`) uses `options.platform ?? detectPlatform(cwd)` so the platform field is always written.
6. **Plumb `--platform` through `cli.ts`.** New `getPlatformFlag(args)` using the existing `getFlagValue` style. `initCommand` adds the parsed value into the `InitOptions` it forwards to `runInit`.
7. **Add the seed file.** `reference/node/github-workflows-ci.yml`
   with the pipeline below.
8. **Update `manifest.json`.** Append the new entry to `scopes.node.seeded`:
   `{ "source": "reference/node/github-workflows-ci.yml", "target": ".github/workflows/ci.yml", "platform": "github" }`. Bump `currentVersion` from `2` to `3`.
9. **Write `changes/0003-platform-aware-ci.md`.** Scopes
   `common`, `node`. Mechanical steps section notes that
   `standards apply` seeds the new CI workflow on platforms where
   `platform: "github"` matches. Judgement step (for the legacy
   migration): `Set repo platform via "standards init --force --platform <p>" if .repometa.json#platform is missing, then re-run "standards apply".` Forgejo CI follows in a later changelog (referenced as `#10`).
10. **Self-bump `.repometa.json`.** Add `"platform": "github"` and
    set `"standards": 3`. The seeded CI workflow can be applied to
    this very repo by `standards apply` as part of the validation
    pass.
11. **Update `README.md` and `SKILL.md`.** README's stamp example
    gets the `platform` field. SKILL.md picks up a one-line rule
    under "Rules".
12. **Tests.** See "Validation plan".

### CI seed (high-level shape)

The seed file ships these steps in order, on `pull_request` and
`push: { branches: [main] }`:

1. `actions/checkout@v4`.
2. `pnpm/action-setup@v6` (current major; the open Renovate PR `#5`
   tracks the bump to v6 — match whatever is current at merge time).
3. `actions/setup-node@v4` with `node-version: 24` and `cache: pnpm`.
4. `pnpm install --frozen-lockfile`.
5. **Pending guard:** `test ! -f .standards/pending.json` with the
   step's `name` set to `Guard: agent step not yet completed for this
PR` so the failure is self-describing.
6. `pnpm run --if-present lint`.
7. `pnpm run --if-present format:check`.
8. `pnpm run --if-present typecheck`.
9. `pnpm run --if-present build`.
10. `pnpm run --if-present test`.
11. `pnpm dlx @sebastian-software/standards check`.

The workflow file lives at the seed source; consumer repos receive it
verbatim once on first `standards apply`. From then on it is owned by
the repo (seeded contract), and any future change is delivered via a
judgement step in a later changelog (see `SKILL.md` rule from `#16`).

### State management

Not relevant.

### API integration

Not relevant — no network access added beyond the existing
`pnpm dlx` invocation.

### Styling approach

Not relevant.

### Accessibility

Not relevant — server-side CLI.

### Edge cases

- **Legacy repo (no `platform` field) at standards 2.** `readRepoMeta`
  parses; `meta.platform` is `undefined`. `apply` skips every
  platform-scoped entry. `--emit-pending` writes the 0003 entry into
  the pending payload because the stamp is older than the manifest
  version; the agent (or human) follows the judgement step and runs
  `standards init --force --platform <p>` to set the field, then
  re-runs `standards apply`.
- **Repo with `platform: "github"`, manifest entry without `platform`.**
  Entry applies (universal scope).
- **Repo with `platform: "forgejo"`, manifest entry with
  `platform: "github"`.** Entry skipped — `check` produces no finding,
  `apply` performs no write.
- **`init` in a repo with no `origin` remote.** `git remote get-url
origin` returns non-zero; `detectPlatform` falls back to `forgejo`.
  The interactive prompt still asks; the non-interactive path uses
  `forgejo` as the default.
- **`init` in a repo whose `origin` URL contains `github.com` in a
  path component (e.g. `git@gitlab.example.com:org/github.com-clone.git`).**
  The substring check misfires. Documented as an accepted limitation
  — the user can override at the prompt or via `--platform`. Stricter
  parsing would require a URL parser; rejected as over-engineering.
- **`--platform o` (short form) from the CLI.** `parsePlatformFlag`
  throws `InitError` — symmetry with the existing `--visibility`
  validator. Interactive prompt continues to accept the short form.
- **`apply` on a repo that is already at standards 3 but missing
  `platform`.** This is a degenerate state (only possible if the user
  edited `.repometa.json` manually). Still safe: platform-scoped
  entries are skipped, no pending changelog applies, no drift is
  reported. The repo remains usable but unfinished — the user is
  expected to fix the meta.
- **CI guard hits in this very repo.** The seed pipeline runs the
  pending guard before linting. Until an agent run leaves
  `.standards/pending.json` (only in the Renovate-driven flow), the
  guard never trips locally because no repo creates the marker
  outside that flow.

## Acceptance criteria

- [ ] `RepoMeta` in `src/repo.ts` carries a `platform` field of type
      `"github" | "forgejo"`, optional at the schema level. Validation
      rejects unknown string values.
- [ ] `src/init.ts` interactively prompts for `platform` with the
      single-letter shortcut pattern (`(g)` / `(f)`), accepts both the
      short and long forms (case-insensitive), and defaults to the
      detected value.
- [ ] `--platform <p>` flag is accepted on `standards init` (long
      form only). Invalid values fail with a clear error.
- [ ] `manifest.json` entries in `managed`, `seeded`, and `sections`
      accept an optional `"platform"` field. Entries without
      `"platform"` apply universally.
- [ ] `src/manifest.ts` parses and types the optional field.
- [ ] `src/apply.ts` filters entries whose `platform` does not match
      the repo's platform — no write, no drift.
- [ ] `src/check.ts` filters symmetrically.
- [ ] Legacy repos without `platform` skip all platform-scoped entries
      and receive the changelog 0003 migration step via the existing
      pending-emit mechanism — no separate marker file is introduced.
- [ ] Unit tests cover the four filter combinations plus the
      universal-entry case.
- [ ] `reference/node/github-workflows-ci.yml` exists with Node 24,
      pnpm, triggers `pull_request` + `push: { branches: [main] }`,
      and the pipeline order documented above.
- [ ] `manifest.json#scopes.node.seeded` lists the new entry with
      `platform: "github"`.
- [ ] `manifest.json#currentVersion` is `3`.
- [ ] `changes/0003-platform-aware-ci.md` exists; scopes
      `common, node`; describes the `platform` migration and the
      GitHub Actions seed.
- [ ] This repo's `.repometa.json` has `platform: "github"` and
      `standards: 3`.
- [ ] `pnpm agent:check` passes locally (lint + format:check +
      typecheck + build + test + check:self).

## Validation plan

- **Unit tests (`vitest`):**
  - `platform filter` describe block: covers the four combinations
    plus the universal case. Each test uses a synthetic
    `SyncContext` (or a fixture with a hand-written
    `.repometa.json#platform`) and a small inline manifest snippet
    to exercise `applyManaged` / `checkManaged` directly.
  - `runInit` tests pick up an explicit `platform` option in the
    happy-path tests so they remain deterministic regardless of
    the surrounding `git` setup.
  - `parsePlatformFlag` / `parsePlatformChoice` get the same
    coverage shape as their visibility counterparts.
  - `detectPlatform` is tested against (a) the existing
    `initGitRepo` fixture with a back-dated `git remote add origin
https://github.com/example/example.git`, expected `"github"`;
    (b) a non-git directory, expected `"forgejo"`.
  - Existing tests stay green; the `createFixtureRepo` helper
    writes a legacy-style meta (no `platform`) and exercises the
    "no platform" fallback for `apply` / `check`.
- **Self-check:** `pnpm check:self` runs the compiled CLI against
  this repo. After self-stamp bump the new CI workflow seed lands
  in `.github/workflows/ci.yml` on first apply; the self-check
  then expects either the file to be present (post-apply) or
  missing (drift finding). The validation flow handles both
  branches.
- **Manual smoke (optional, documented in the closing PR
  description):** run `node dist/cli.js apply --cwd <fixture>`
  in a temp directory with a fixture `.repometa.json` and a
  `package.json`, verify that the workflow file lands when
  `platform: "github"` and does not land when `platform: "forgejo"`.

## Assumptions and open points

- **Verified:** the existing `runInit` prompt loop in `src/init.ts`
  supports adding a third question by extending the `PromptContext`
  shape and the `resolveInteractive` function. Same pattern as the
  visibility / since prompts.
- **Verified:** `buildPendingPayload` in `src/sync.ts` reads `meta`
  and includes the relevant changelog entries; no change is needed
  to deliver 0003 to legacy repos.
- **Assumption:** the `pnpm/action-setup` major version is whatever
  is current at merge time (Renovate PR `#5` is open against v6).
  The seed file matches the version that is current when this PR
  is opened; future bumps land via Renovate as for any other CI
  workflow.
- **Assumption:** consumer repos using GitHub use the default branch
  name `main`. Repos that override the default branch must adapt the
  seeded workflow themselves (the seeded contract permits this).
- **Open:** the matching companion PR in `standards-test-repo2`
  (manually setting `platform: "github"` in its `.repometa.json`)
  is tracked separately as `standards-test-repo2#4`. Out of scope
  for this implementation but a prerequisite for the next end-to-end
  drift PR.
- **Open:** if a later Forgejo CI changelog (`#10`) introduces a
  shared `pnpm run --if-present` pipeline shape, the GitHub seed may
  be refactored to import a shared snippet. Out of scope here.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    3 |
| Security        |        0 |         0 |    1 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    2 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    2 |
| Maintainability |        0 |         0 |    2 |

### Findings

- **Architecture — hint:** Filter helper placement (sync.ts vs. local in apply/check) is left to implementation; either keeps the existing complexity budget within limits. Either is acceptable.
- **Architecture — hint:** Platform-default detection is intentionally heuristic — `forgejo` for non-github.com URLs is a safe over-approximation given the current org composition (mostly GitHub; Forgejo is opt-in by URL).
- **Architecture — hint:** The seeded CI workflow does not interact with the consumer's existing CI in any privileged way; it is just another seeded file from the repo's perspective. The seeded-update contract (rule introduced in `#16`) governs future evolutions of the file.
- **Security — hint:** `pnpm dlx @sebastian-software/standards check` in the seed pipeline pulls the package from npm at every CI run. No new credential surface introduced; the existing `pnpm` SSRF posture covers it. `--frozen-lockfile` prevents transitive surprises in the consumer's main install step.
- **Failure modes — hint:** Legacy repos at standards 2 see no platform-scoped writes from `apply` even when nothing else changes. The pending payload from `--emit-pending` carries the 0003 migration step; absence of `pending.json` deletion on no-op is already covered by plan 0001.
- **Failure modes — hint:** `detectPlatform` is best-effort. Any failure mode (missing git, no remote, timeout) maps to `forgejo` so the prompt default is always populated. The user always has the final word interactively or via `--platform`.
- **Testability — hint:** The unit tests for the filter logic exercise the four-way matrix directly on `applyManaged`/`checkManaged` with a synthetic manifest snippet; this isolates the filter from the rest of the apply pipeline and keeps the test small.
- **Scope — hint:** Forgejo CI is intentionally out of scope (tracked in `#10`). The schema and filter changes are forward-compatible — adding `platform: "forgejo"` entries later requires no further code changes.
- **Scope — hint:** Companion stamp in `standards-test-repo2` is mentioned but explicitly out of scope. Cross-repo coordination via the linked issue.
- **Maintainability — hint:** `Platform` type lives in `src/repo.ts` and is re-exported / consumed by `src/manifest.ts` and `src/init.ts`. Single source for the literal union avoids drift if a third platform ever appears.
- **Maintainability — hint:** Self-bump in `.repometa.json` keeps the repo on the manifest version it ships, so `check:self` always reflects current reality.

## Test results

- `pnpm agent:check` — green (lint + format:check + typecheck + build + 70 tests + `standards check` self-check)
- New tests covering platform-aware behaviour:
  - `parsePlatformFlag`, `parsePlatformChoice`, `detectPlatform` (URL heuristic with offline and missing-remote fallbacks)
  - `matchesPlatform` (four-way matrix: undefined entry/meta combinations)
  - `runApply` writes the GitHub-scoped CI workflow only on `platform: "github"` repos and skips it on `platform: "forgejo"` repos.
  - `runApply` on a legacy repo (no `platform` field) skips every platform-scoped entry **and** refuses to bump the standards stamp until `platform` is set.
  - `runCheck` emits a stamp finding for legacy repos missing `platform` when platform-scoped entries exist.
  - `runInit` non-interactive mode pulls the platform default from `git remote get-url origin`.
  - Interactive `runInit` aborts after three invalid platform attempts.

## Review findings

Reviewer: `/nodejs-reviewer`. Counts: 0 critical, 4 important, 11 hints.

Addressed in this PR:

- **F4 — Failure modes (important):** `runApply` no longer bumps `.repometa.json#standards` when `meta.platform` is missing and the manifest contains platform-scoped entries; `runCheck` adds a complementary stamp finding so legacy repos see drift until they set `platform`. Stops a partial v3 upgrade where the stamp moves to 3 but no GitHub workflow is written.
- **F8 — Testability (important):** Added "aborts after 3 invalid platform attempts" test in `test/standards.test.ts` covering the retry-loop cap for the new prompt.
- **F9 — Maintainability (important):** `reportInitResult` in `src/cli.ts` now includes the `platform=` field in both the `Reset` and `Wrote` lines so the reset output stays informative for migrations.
- **F13 — Testability (important):** Added "detects platform from origin URL in non-interactive mode" test feeding a GitHub URL through `runInit` to lock in the `forgejo` → `github` upgrade path.
- **F3 — Testability (important):** Added end-to-end platform filter tests against `runApply`/`runCheck` covering the github, forgejo, and legacy fixtures, the no-drift contract, and the new "platform is missing" stamp finding.

Documented as open follow-ups in `.sf-plugin/review/review-report-2026-06-18-plan-0009.md`:

- **F1 — Scope (hint):** Standards' own `.github/workflows/ci.yml` will diverge from the seeded reference after the next refactor; tracking external because the self-repo runs its own pre-publish gating distinct from the seeded shape.
- **F2 — Maintainability (hint):** `--platform=value` syntax is not supported because the existing `getFlagValue` parser does not split on `=`. Out of scope for this plan; better solved by a parser refactor that hits all flags at once.
- Remaining hints (F5–F7, F10–F12, F14, F15) — see the review report for the breakdown.
