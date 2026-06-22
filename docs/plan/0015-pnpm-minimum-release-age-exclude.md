# 0015: Exclude own org packages from pnpm release cooldown

**Plan status:** Implemented
**Source:** /build
**Recommended workflow:** Feature (`/build`)

## Requirement

The org's own npm packages must load directly, without pnpm's minimum
release age cooldown. This applies to every `@sebastian-gmbh/*` and
`@sebastian-software/*` package. Add it to the node standard and to the
changelog.

## Architecture decisions

- **Mechanism: `minimumReleaseAgeExclude` with scope globs.** pnpm 11 enables
  supply-chain protection by default — `minimumReleaseAge` defaults to `1440`
  minutes (24h). Rather than disabling the cooldown globally (which would drop
  protection for all third-party deps), the two org scopes opt out via
  pnpm's pattern-capable `minimumReleaseAgeExclude`. Third-party deps keep the
  secure default.
- **Propagation via changelog judgement step, not manifest wiring.**
  `pnpm-workspace.yaml` is a reference file only; it is not managed or seeded
  (its `allowBuilds` list is repo-specific, so byte-exact sync is wrong and
  create-once seeding would not update existing repos). The established
  propagation path for such config merges is a changelog judgement step, per
  the SKILL.md rule. Change `0006` carries it.
- **Stacked on PR #50.** This change builds on the open oxfmt branch
  (`changes/0005`), so it lands as `changes/0006` / standards version 6 with no
  numbering gap. Merge order: #50 first, then this PR.

## Affected files

| File                                               | Change                                                |
| -------------------------------------------------- | ----------------------------------------------------- |
| `reference/node/pnpm-workspace.yaml`               | Add `minimumReleaseAgeExclude` with the two org globs |
| `pnpm-workspace.yaml`                              | Same, for self-compliance                             |
| `changes/0006-pnpm-minimum-release-age-exclude.md` | New changelog (node scope, v6) with judgement step    |
| `manifest.json`                                    | `currentVersion` 5 → 6                                |
| `.repometa.json`                                   | `standards` 5 → 6                                     |
| `test/standards.test.ts`                           | `selectChanges` version expectations extended to 6    |

## Implementation details

Added to both `pnpm-workspace.yaml` files:

```yaml
minimumReleaseAgeExclude:
  - "@sebastian-gmbh/*"
  - "@sebastian-software/*"
```

## Test results

`pnpm agent:check` green — lint, format:check, typecheck, build, 75 tests, and
`standards check` self-check (repo matches its own standards at version 6).

## Review-Findings

**Datum:** 2026-06-22
**Reviewer:** keiner

### Zusammenfassung

Kein separater Reviewer-Lauf: Änderung ist ein additiver Config-Block plus
Changelog ohne Code-Logik. Validierung über `pnpm agent:check`. Keine Findings.
