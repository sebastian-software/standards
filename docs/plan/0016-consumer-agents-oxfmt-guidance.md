# 0016: Consumer AGENTS guardrail for managed files and oxfmt

**Plan status:** Implemented
**Source:** /firmo plan https://github.com/sebastian-software/standards/issues/55
**Recommended workflow:** Feature (`/firmo build`)

## Requirement

Issue 55 documents a real failure mode in standards-consuming repositories:
an agent changed the managed `.oxfmtrc.json` locally to ignore a generated
OpenAPI artifact. The repo-local `pnpm agent:check` was green, but CI failed
later because `pnpm dlx @sebastian-software/standards check` detected managed
file drift. The guidance must reach agents working inside consumer repos, so
it must not live only in this package's `SKILL.md`.

Add a very short standards-owned Consumer AGENTS instruction and sync it into
consumer `AGENTS.md` files through the existing section mechanism. The guidance
must explicitly say that files reported by `oxfmt` should generally be fixed.
Only when formatting is not viable may a repo-local `.prettierignore` be used;
agents must not edit managed `.oxfmtrc.json` for repo-specific ignores.

This is a feature because it changes what `standards apply` propagates into
consumer repositories and bumps the standards version.

## Architecture decisions

- **Use the existing `sections` mechanism for `AGENTS.md`.** `src/apply.ts`
  already applies marker-delimited sections declared in `manifest.json`; the
  mechanism is generic and not tied to README files. A common-scope section can
  create or update `AGENTS.md` in every managed repo without introducing a new
  file-sync primitive.
- **Keep `CONSUMER-AGENTS.md` as the source template.** The standards repo gets
  a concise root-level `CONSUMER-AGENTS.md`. `manifest.json` references it as
  the template for the `AGENTS.md` section. Because `package.json#files` does
  not currently include arbitrary root markdown files, the implementation must
  also include `CONSUMER-AGENTS.md` in the published package.
- **Make the section common-scope, not node-only.** The managed-files warning
  applies to every standards-managed repo. The oxfmt paragraph is conditional
  wording inside the short text and is relevant where oxfmt exists.
- **Update `changes/0005` instead of leaving conflicting guidance.** Change
  0005 currently says future formatter ignores belong in managed
  `.oxfmtrc.json#ignorePatterns`. That is true for standards-owned global
  ignores, but misleading for consumer repo-specific generated artifacts. It
  must be amended to distinguish global baseline ignores from local exceptions.
- **Add a new changelog for standards version 7.** Existing consumers at
  version 6 need a pending judgement instruction that `standards apply` will
  sync the AGENTS section and that agents should read/follow it in future work.

## Affected files

| File                                         | Description                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONSUMER-AGENTS.md`                         | New short source text for consumer-repo agents                                                                                              |
| `manifest.json`                              | Add a common `AGENTS.md` section and bump `currentVersion` to 7                                                                             |
| `package.json`                               | Include `CONSUMER-AGENTS.md` in the published package files                                                                                 |
| `AGENTS.md`                                  | Created or updated in this repo by self-application so `check:self` passes                                                                  |
| `changes/0005-oxfmt-ignore-patterns.md`      | Clarify that repo-specific ignores must not be added to managed `.oxfmtrc.json`; prefer fixing/formatting, `.prettierignore` only if needed |
| `changes/0007-consumer-agents-guardrails.md` | New changelog entry for propagating the Consumer AGENTS section                                                                             |
| `.repometa.json`                             | Bump self stamp to standards version 7                                                                                                      |
| `src/branding.ts`                            | Render marker sections with a blank line after the start marker so Markdown headings and lists stay formatter-stable                        |
| `test/standards.test.ts`                     | Cover AGENTS section application and version/change selection expectations                                                                  |

## Implementation details

### Approach

1. Add `CONSUMER-AGENTS.md` with a deliberately short text. It should tell
   agents to read it via the standards-owned section, avoid hand-editing
   managed files, remember that `agent:check` may not include
   `standards check` in consumer repos, and treat oxfmt findings by fixing or
   formatting the reported file first. The section renderer emits a blank line
   after the start marker so normal Markdown headings and lists stay stable
   under `oxfmt` and `standards check`.
2. Keep the oxfmt guidance terse and strict:
   - fix or format everything `oxfmt` reports whenever practical;
   - for generated artifacts, prefer formatting in the generator step;
   - only if the file cannot reasonably be formatted, use repo-local
     `.prettierignore`;
   - do not add repo-specific paths to managed `.oxfmtrc.json`.
3. Add a common section in `manifest.json` targeting `AGENTS.md`, for example
   marker `sebastian-software-consumer-agents`, with both `oss` and `private`
   templates pointing at `CONSUMER-AGENTS.md`.
4. Ensure the root template ships in the npm package by extending
   `package.json#files`.
5. Bump `manifest.json#currentVersion` and this repo's `.repometa.json`
   standards stamp from 6 to 7.
6. Create `changes/0007-consumer-agents-guardrails.md` with common scope. Its
   mechanical step is the `AGENTS.md` section sync; its judgement step is to
   keep existing repo-local AGENTS content intact and make sure future agents
   follow the standards-owned section.
7. Amend `changes/0005-oxfmt-ignore-patterns.md` so the final note no longer
   suggests that every future formatter ignore belongs in managed
   `.oxfmtrc.json`. The revised wording should reserve `.oxfmtrc.json` for
   standards-owned global baseline ignores and point consumer-specific
   generated-artifact exceptions to the Consumer AGENTS rule.
8. Run `standards apply` or make the equivalent self-repo changes so the new
   `AGENTS.md` section exists locally; otherwise `pnpm check:self` will report
   the new common section as missing.
9. Update tests to assert that `runApply` creates or updates `AGENTS.md` with
   the new marker, `runCheck` detects section drift, and `selectChanges`
   includes version 7 for relevant common/node consumers.

### Edge cases

- **Existing consumer `AGENTS.md`:** preserve all repo-local content outside
  the standards markers. The existing `upsertSection` behavior should handle
  append and replace without extra logic.
- **Missing consumer `AGENTS.md`:** the common section mechanism should create
  the file. Tests should cover creation because many repos may not have one.
- **Context budget:** keep `CONSUMER-AGENTS.md` short. Do not copy long managed
  file lists from `manifest.json`; refer to `standards check` and the
  standards-owned section instead.
- **Conflicting old wording:** `changes/0005` must be updated in the same
  implementation, because otherwise the changelog would tell agents to put
  future ignores into `.oxfmtrc.json`, contradicting the new guardrail.
- **Published package:** if `CONSUMER-AGENTS.md` is not added to
  `package.json#files`, installed `standards apply` runs will fail when reading
  the section template from the package root.

## Acceptance criteria

- [x] `CONSUMER-AGENTS.md` exists and is short, with explicit guidance for
      managed files, `standards check`, and oxfmt findings.
- [x] `standards apply` creates or updates a standards-owned section in
      consumer `AGENTS.md` files without overwriting repo-local AGENTS content.
- [x] The Consumer AGENTS text says oxfmt findings should generally be fixed or
      the generated output formatted, and `.prettierignore` is only the fallback
      when fixing/formatting is not viable.
- [x] The Consumer AGENTS text says repo-specific formatter exceptions must not
      be added to managed `.oxfmtrc.json`.
- [x] `changes/0005-oxfmt-ignore-patterns.md` is amended so it no longer
      recommends managed `.oxfmtrc.json` for consumer-specific future ignores.
- [x] `changes/0007-consumer-agents-guardrails.md`, `manifest.json`,
      `.repometa.json`, and tests are updated consistently for standards
      version 7.
- [x] `pnpm agent:check` is green after implementation, including self
      `standards check`.

## Validation plan

- `pnpm test` to cover the section sync, drift detection, and changelog
  selection behavior.
- `pnpm agent:check` as the final gate because this repo's script includes
  lint, format, typecheck, build, tests, and `standards check`.
- Manual inspection of `CONSUMER-AGENTS.md` for brevity and consistency with
  the issue: no long managed-file inventory and no instruction to edit
  `.oxfmtrc.json` for repo-local generated artifacts.

## Test results

- `pnpm vitest run test/standards.test.ts` — passed, 76 tests.
- `pnpm agent:check` — passed: lint, format check, typecheck, build, tests, and
  self `standards check`.

## Assumptions and open items

- **Verified:** `manifest.json` currently has a common README section and an
  empty node `sections` list; `.oxfmtrc.json` is the only current managed node
  file.
- **Verified:** `src/apply.ts` and `src/sync.ts` already support generic
  marker-delimited sections for arbitrary target files.
- **Verified:** `changes/0005-oxfmt-ignore-patterns.md` currently says future
  formatter ignores belong in `ignorePatterns`, which needs the consumer-local
  exception added.
- **Assumption:** The new Consumer AGENTS section should apply to all managed
  repos through the common scope, not only node repos, because the managed-file
  guardrail is stack-agnostic.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    1 |
| Security        |        0 |         0 |    0 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    2 |
| Testability     |        0 |         0 |    0 |
| Scope           |        0 |         0 |    1 |
| Maintainability |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** Reusing `sections` avoids a second sync mechanism
  and fits the existing README branding pattern.
- **Failure modes — hint:** The package publish edge case is explicitly covered
  by adding `CONSUMER-AGENTS.md` to `package.json#files`.
- **Failure modes — hint:** The self-check edge case is explicit: the standards
  repo itself must receive the new `AGENTS.md` section or `check:self` will
  fail.
- **Scope — hint:** The plan intentionally does not add `standards check` to
  every consumer `agent:check`; that can stay a later hardening task.
- **Maintainability — hint:** The Consumer AGENTS text should reference the
  managed-file contract instead of duplicating a manifest-derived file list,
  keeping context cost low.

## Open Points

- No open points.

## Review-Findings

**Date:** 2026-07-08
**Reviewer:** self-review

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Fixed                  |     0 |
| Open / Not implemented |     0 |

No findings found.
