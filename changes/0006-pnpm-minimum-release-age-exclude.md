# 0006 — pnpm: load own org packages without the release cooldown

- **Scopes:** node
- **Standards version:** 6

## Intent

Exempt the organisation's own npm packages from pnpm's supply-chain release
cooldown so internal releases install immediately instead of after a one-day
delay.

## Problem

pnpm 11 enables supply-chain protection by default: `minimumReleaseAge`
defaults to `1440` minutes (24h), so a freshly published version is not
resolved until it is at least a day old
([pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)). That cooldown
is desirable for third-party dependencies, but it also stalls the org's own
packages — a just-released `@sebastian-software/*` or `@sebastian-gmbh/*`
version is invisible to consumers for 24h, which blocks fast internal
iteration and back-to-back releases.

pnpm's `minimumReleaseAgeExclude` accepts name patterns
([pnpm 10.17 notes](https://pnpm.io/blog/releases/10.17)), so the two org
scopes can opt out of the cooldown while every other dependency keeps it.

## Mechanical steps (covered by `standards apply`)

None. `pnpm-workspace.yaml` is not a managed or seeded file (its `allowBuilds`
list is repo-specific), so `standards apply` does not write it. The reference
`reference/node/pnpm-workspace.yaml` documents the canonical shape; adoption is
a judgement step.

## Judgement steps (agent work, node scope)

1. **Add the org cooldown exclusion to `pnpm-workspace.yaml`.** Add (or extend)
   a top-level `minimumReleaseAgeExclude` list with the two org scopes:

   ```yaml
   minimumReleaseAgeExclude:
     - "@sebastian-gmbh/*"
     - "@sebastian-software/*"
   ```

   Keep any repo-specific existing entries and merge the two org globs in;
   do not touch `packages:` or `allowBuilds:`. If the repo has no
   `pnpm-workspace.yaml`, create one from `reference/node/pnpm-workspace.yaml`.

## Notes

- This only opts the two org scopes out of the cooldown; `minimumReleaseAge`
  keeps its secure default for all third-party dependencies.
- Pattern syntax follows pnpm's `minimumReleaseAgeExclude`; exact versions or
  `||` disjunctions also work but are not needed here.
