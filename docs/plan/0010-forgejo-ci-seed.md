# 0010: Forgejo Actions CI seed (standards v4)

**Plan status:** Implemented
**Source:** /build
**Recommended workflow:** Feature (`/build`)

## Requirement

Issue #9 (plan 0009, PR #33) landed the platform-aware manifest plus
the GitHub Actions CI seed. With the schema and filter in place,
Forgejo CI is purely additive: a second reference file and a second
manifest entry. The CLI does not change; the existing `platform`
filter routes the new entry to Forgejo-only repos.

This bumps standards to version 4 and ships changelog 0004 covering
the Forgejo seed. No GitHub-side change is observable: GitHub repos
move from stamp 3 to stamp 4 with no extra file writes (beyond the
stamp itself).

## Architecture decisions

- **Forgejo workflow path is `.forgejo/workflows/ci.yml`.** Forgejo
  Actions discovers workflows there first and falls back to
  `.github/workflows/` only when the Forgejo path is missing.
  Choosing the Forgejo-native path keeps the two seeds independent
  per platform.
- **`runs-on: docker` with an explicit `container` image.** The seed
  cannot assume an `ubuntu-latest` runner label is registered. Pinning
  `code.forgejo.org/oci/node:24-bookworm` keeps the seed reproducible
  across runner pools and avoids leaking implicit image defaults.
- **Pipeline shape mirrors the GitHub seed.** Same `pending.json`
  guard, same `pnpm run --if-present` chain, same trailing
  `pnpm dlx @sebastian-software/standards check` drift gate. Stable
  behaviour across platforms is the whole point of the platform
  filter.
- **`setup-node` stays even with the explicit container.** The
  container provides Node 24 at the OS level; `setup-node` enables
  pnpm-aware caching when the runner backend supports it. Cost on
  Forgejo is one no-op step in the worst case; benefit is parity with
  the GitHub seed.
- **No CLI change.** The platform filter from plan 0009 already
  routes the new entry. Nothing in `src/` needs to move.

## Affected files

| File                                      | Description                                    |
| ----------------------------------------- | ---------------------------------------------- |
| `reference/node/forgejo-workflows-ci.yml` | New Forgejo-native CI reference                |
| `manifest.json`                           | `currentVersion: 4`, new seeded entry          |
| `changes/0004-ci-workflow-forgejo.md`     | New changelog (scope: node, version 4)         |
| `.repometa.json`                          | Self-bump `standards` to 4                     |
| `test/standards.test.ts`                  | Extend platform-filter tests for Forgejo entry |
| `docs/plan/0010-forgejo-ci-seed.md`       | This plan                                      |

## Implementation details

### Approach

1. Author the Forgejo reference workflow at
   `reference/node/forgejo-workflows-ci.yml`. Mirror the GitHub seed
   step-by-step, replace `runs-on: ubuntu-latest` with
   `runs-on: docker` + `container: code.forgejo.org/oci/node:24-bookworm`.
2. Add the seeded entry to `manifest.json#scopes.node.seeded` with
   `platform: "forgejo"` and target `.forgejo/workflows/ci.yml`.
3. Bump `manifest.json#currentVersion` to 4.
4. Add changelog `changes/0004-ci-workflow-forgejo.md` covering scope
   `node`, intent, mechanical/judgement steps, and a notes section
   that calls out the path-fallback behaviour and the runner image
   choice.
5. Self-bump `.repometa.json#standards` to 4 so `check:self` stays
   green for this repository.
6. Extend the existing platform-filter tests with a Forgejo fixture
   that confirms the new file is written on `platform: "forgejo"`
   and skipped on `platform: "github"` / legacy repos.

### Edge cases

- **Legacy repos (no `platform`):** the v3 legacy gate from plan 0009
  still blocks the stamp bump; the v4 entry is filtered out too.
  The migration step from change 0003 carries forward — once set,
  apply lands every applicable entry up to v4.
- **GitHub repo with the v4 stamp:** the only observable change is
  the stamp bump. No file write under `.forgejo/`.
- **Forgejo repo with an existing `.forgejo/workflows/ci.yml`:** the
  seeded contract leaves the file untouched. The 0004 judgement step
  documents the merge guidance.
- **Forgejo repo with a pre-existing `.github/workflows/ci.yml`** (e.g.
  migrated from GitHub): Forgejo Actions still picks up the new
  `.forgejo/workflows/ci.yml` once seeded; legacy `.github/`
  workflows stop running. The judgement step calls this out so the
  agent / maintainer can clean up.

## Acceptance criteria

- [x] `reference/node/forgejo-workflows-ci.yml` exists and ships the
      same pipeline shape as the GitHub seed.
- [x] `manifest.json#currentVersion === 4`.
- [x] `manifest.json#scopes.node.seeded` contains the Forgejo entry
      with `platform: "forgejo"`.
- [x] `changes/0004-ci-workflow-forgejo.md` exists with scope `node`,
      standards version 4, and the mechanical / judgement / notes
      sections.
- [x] Tests cover that `runApply` writes the Forgejo file on
      `platform: "forgejo"` repos and skips it on GitHub / legacy.
- [x] `runCheck` on a Forgejo fixture is clean after `runApply`.
- [x] `pnpm agent:check` green (lint + format:check + typecheck +
      build + tests + `standards check` self-check).
- [x] `.repometa.json#standards === 4` so the standards repo's
      `check:self` passes against the new manifest version.

## Validation plan

- `pnpm agent:check` (full chain)
- New unit tests:
  - "writes the forgejo-scoped CI workflow on a forgejo repo"
  - "skips the forgejo-scoped CI workflow on a github repo"
  - "skips the forgejo-scoped CI workflow on a legacy repo"
- Reuse existing legacy-gate, github-fixture, and missing-platform
  tests; they remain green without modification.

## Assumptions and open items

- **Assumption:** The Forgejo runner that the consumer team uses has
  access to `code.forgejo.org/oci/node:24-bookworm` (or a mirror).
  If a deployment lacks this image, the consumer team can adjust the
  container reference in their copy of the seeded file (seeded
  contract: repo owns the file after first creation).
- **Assumption:** `pnpm/action-setup@v6` and `actions/setup-node@v6`
  are available on the Forgejo Actions runner (most pools mirror
  the GitHub Marketplace catalog).
- **Open:** Forgejo Actions caching for pnpm depends on the runner
  backend; on first apply, consumers may see a no-op cache step.
  Not blocking; the pipeline still runs.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    2 |
| Security        |        0 |         0 |    1 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    2 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    2 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** The Forgejo seed deliberately uses the
  same pipeline shape as the GitHub seed. Future divergence (e.g.
  matrix support on one side only) is acceptable because each seed
  is independently owned by the repo after first creation.
- **Architecture — hint:** Path fallback behaviour (Forgejo reads
  `.github/workflows/` if `.forgejo/workflows/` is missing) gives a
  graceful migration path from GitHub-style workflows to Forgejo-
  native ones.
- **Security — hint:** `code.forgejo.org/oci/node:24-bookworm` is
  pulled at every run. Same supply-chain posture as the GitHub seed
  (`pnpm dlx` pull). No new credentials introduced.
- **Failure modes — hint:** Missing container image on a Forgejo
  runner pool fails the job loudly; not silent drift.
- **Failure modes — hint:** Legacy (no `platform`) Forgejo repos
  follow the v3 migration path before the v4 entry takes effect.
  No new migration logic needed.
- **Testability — hint:** Reusing the existing
  `createPlatformFixture` helper from plan 0009 keeps the new tests
  short.
- **Scope — hint:** Forgejo runner setup (admin side) stays out of
  scope. The seed assumes a working `runs-on: docker` pool.
- **Scope — hint:** `standards-test-repo2` stamp coordination stays
  out of scope; tracked externally.
- **Maintainability — hint:** Both CI references live under
  `reference/node/<platform>-workflows-ci.yml`. If a third platform
  is ever added, the naming pattern scales without rename.

## Test results

- `pnpm agent:check` — green (lint + format:check + typecheck + build + tests + `standards check` self-check)
- New tests covering Forgejo-aware behaviour:
  - `runApply` writes `.forgejo/workflows/ci.yml` only on `platform: "forgejo"` repos.
  - `runApply` skips the Forgejo seed on `platform: "github"` and legacy repos.
  - `runCheck` reports no drift after apply on a Forgejo fixture.
  - Existing GitHub fixture tests stay green; no regression.

## Review findings

Reviewer: inline self-review (small additive change). Counts: 0 critical, 0 important, 0 hints — no follow-ups beyond the open items above.
