# 0004: Consistent `writeFileSync` encoding across the codebase

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Refactoring (`/refactor`)

## Requirement

Two of the four `writeFileSync` call sites in this repo pass an explicit
`"utf8"` argument; two do not. Node defaults to UTF-8, so the behavior
is identical today, but the mixed style makes the code harder to read
and invites accidental Buffer-vs-string drift later. The plan adds the
explicit `"utf8"` argument everywhere a string is being written.

No behavior change is intended — refactoring.

## Architecture decisions

- **Always pass `"utf8"` when writing a string.** Aligns with the
  existing pattern in `src/sync.ts:127` (`writePending`) and clarifies
  intent at every call site.
- **Do not introduce a project-wide write helper.** The duplication is
  three lines across two files; an abstraction layer is over-engineering
  for the current scope.
- **Touch only string writers.** If a future call writes a `Buffer`, the
  encoding argument is omitted naturally.

## Affected files

| File                     | Description                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/apply.ts`           | Add `"utf8"` to the two `writeFileSync` calls (line 19 in `writeTarget`, line 56 in `applySections`). |
| `src/repo.ts`            | Add `"utf8"` to the `writeFileSync` call inside `writeRepoMeta` (line 46).                            |
| `test/standards.test.ts` | No new tests required; the existing apply and repo-meta tests already cover both writers.             |

## Implementation details

### Approach

1. **`src/apply.ts`** — `writeFileSync(path, content)` →
   `writeFileSync(path, content, "utf8")` at both call sites
   (`writeTarget` for managed/seeded files, `applySections` for branding
   sections).
2. **`src/repo.ts`** — `writeFileSync(path, ...)` →
   `writeFileSync(path, ..., "utf8")` inside `writeRepoMeta`.
3. **No change to `src/sync.ts`.** `writePending` already passes
   `"utf8"`.
4. **No change to tests.** Existing tests assert content equality; the
   read side already uses `"utf8"` consistently and would have caught
   any divergence.

### State management

Not relevant.

### API integration

Not relevant.

### Styling approach

Not relevant.

### Accessibility

Not relevant.

### Edge cases

- **Existing tests that write fixtures.** Tests in
  `test/standards.test.ts` use `writeFileSync` without `"utf8"` in
  several places (e.g. fixture setup). They are test-internal and not
  part of the production surface; leaving them as-is keeps the PR
  tightly scoped to the production source.
- **Future Buffer writes.** Not introduced by this change. If a future
  call writes a `Buffer`, the encoding argument is omitted naturally
  and TypeScript would catch the mismatch.

## Acceptance criteria

- [x] All three production `writeFileSync` call sites for string content
      include `"utf8"` as the encoding argument.
- [x] `pnpm agent:check` passes; the existing 40 tests stay green.
- [x] `grep -n 'writeFileSync(' src/` shows no call without an encoding
      argument when the content is a string.

## Validation plan

- **Self-check:** `pnpm check:self` stays green — byte-for-byte output
  is unchanged (UTF-8 is Node's default), so neither managed-file diffs
  nor branding-section comparisons change.
- **Apply integration:** the existing `apply write contract` test
  exercises both call sites in `src/apply.ts`; the existing
  `runApply`/`runInit` tests exercise `writeRepoMeta`. No new tests are
  needed.
- **Manual grep verification:** post-refactor, every
  `writeFileSync(` line in `src/` either ends with `, "utf8"` or writes
  a `Buffer`.

## Assumptions and open points

- **Verified:** Node defaults `writeFileSync` to UTF-8 for string
  content, so no observable behavior change. The change is purely
  stylistic / readability.
- **Assumption:** parallel refactors (plans 0003 and 0006) do not
  change the same three lines. They modify different lines; merge
  conflicts on `src/apply.ts` and `src/repo.ts` are unlikely but
  possible (plan 0003 touches `src/apply.ts` line ~62, far from
  lines 19 and 56).

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

- **Architecture — hint:** No new helper introduced; three call sites
  do not justify abstraction.
- **Testability — hint:** No new tests because existing read-side tests
  already detect encoding drift indirectly.
- **Scope — hint:** Test-file `writeFileSync` calls are intentionally
  left alone to keep the PR small and focused on production source.
- **Maintainability — hint:** Explicit `"utf8"` signals intent and
  prevents accidental Buffer-vs-string drift in future edits.

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

No new tests required; existing apply and repo-meta tests already cover both writers.

## Review findings

**Date:** 2026-06-18
**Reviewer:** workflow self-review (mechanical change)

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     0 |
| Open / Not implemented |     0 |

Keine Findings gefunden. Three identical mechanical replacements (`writeFileSync(path, content)` → `writeFileSync(path, content, "utf8")`); full reviewer pass omitted because there is nothing meaningful to assess beyond what the validator gates already covered.
