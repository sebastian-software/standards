# 0011 — Pin the standards CLI that consumer CI executes

- **Scopes:** common, node, rust
- **Standards version:** 11

## Intent

Make the version of `@sebastian-software/standards` that runs in a consumer's
CI a reviewed, pinned dependency instead of whatever the registry published
most recently.

## Problem

The seeded CI step ran

```sh
pnpm --config.minimum-release-age=0 dlx @sebastian-software/standards check
```

on every pull request and every push to `main`. The package is in no consumer's
manifest and no lockfile, and the command switches the release-age safeguard
off. A compromised or simply broken release therefore executes in ten
repositories' CI, with the job's token, within minutes of being published —
before anybody has reviewed it. Greptile raised it on
sebastian-software/ferramenta#22; the issue is
sebastian-software/standards#66.

The behavior was deliberate: `check` compares against the _latest published_
standards so drift surfaces without a manual bump, and the age bypass exists
because the org cooldown would otherwise hold back the version `apply` just
stamped with. But drift does not need an unpinned CLI. Renovate already watches
`manifest.json#currentVersion`, so a new version arrives as a pull request
either way — the pin only decides whether CI runs reviewed code while it waits.

## Mechanical steps (covered by `standards apply`)

Two seeded CI references change their `standards check` step; the reference
Rust workflow, which is copied by hand, changes the same step:

- `reference/node/github-workflows-ci.yml` and
  `reference/node/forgejo-workflows-ci.yml` — `pnpm exec standards check`. The
  version comes from the repository's own devDependency and lockfile, which
  `pnpm install --frozen-lockfile` has already installed one step earlier.
- `reference/rust/ci.yml` — the same step with the version in the command,
  because a Rust-only repository has no lockfile to hold it:

  ```sh
  pnpm --config.minimum-release-age=0 \
    dlx @sebastian-software/standards@0.9.0 check
  ```

`--config.minimum-release-age=0` stays on the `dlx` form and on manual `apply`
runs: pnpm 11 holds versions younger than 24 hours back, so a pin raised on the
day of a release could not resolve at all without it. It is **not** needed for
`pnpm install --frozen-lockfile`, which installs an already-resolved version
rather than resolving one. If a pnpm release ever changes that, add the flag to
the install step rather than un-pinning the CLI.

## Judgement steps (agent work)

1. **Node-scope repositories: add the devDependency.** Pin it exactly, no range:

   ```sh
   pnpm add --save-dev --save-exact @sebastian-software/standards
   ```

   Then replace the `dlx` line in `.github/workflows/ci.yml` (or
   `.forgejo/workflows/ci.yml`) with `pnpm exec standards check`. A repository
   whose CI does not install dependencies before that step has to add
   `pnpm install --frozen-lockfile` first — the seeded workflow already does.
   Nested workspaces install from the root lockfile, so the devDependency
   belongs in the package.json the CI job installs from.

2. **Rust-only repositories: pin the `dlx` version.** Set it to the version the
   repository was last applied with — the same number as
   `manifest.json#currentVersion` maps to, not a guess — and add the Renovate
   custom manager from
   [`reference/rust/README.md`](../reference/rust/README.md) to the
   repository's `renovate.json`. If the org preset
   (`sebastian-software/renovate-config:standards`) grows the same custom
   manager later, drop the repository-local copy in favor of it; the preset is
   the better home, and nothing here depends on which one carries it.
3. **Raise the pin and run `apply` in the same pull request.** This is the step
   that is easy to get wrong: `check` compares the repository's stamp against
   the `manifest.json` of the CLI that runs it, and it reports drift in **both**
   directions. A repository stamped 11 whose CI still runs 0.8.0 (manifest 9)
   fails its own drift lane. So the Renovate bump PR that raises the pin is the
   PR that runs `apply`, and a manual `apply` is followed by raising the pin.
4. **Do not use a range.** `^0.9.0` in a devDependency would let a lockfile
   refresh pull in an unreviewed version, which is the thing this version
   removes. `--save-exact` and a pinned `dlx` argument, both moved by Renovate.

## Notes

- The pin in `reference/rust/ci.yml` names the release that carries this change.
  If the release lands under a different number, that reference, the runbook
  example and this entry take the actual number in a follow-up; nothing else
  depends on the value.
- This does not slow drift detection down. Renovate opens the bump PR from the
  `manifest.json#currentVersion` datasource as before; what changes is that the
  new CLI runs first in that PR, where a human sees it, instead of in every
  repository's CI at once.
- `standards init` in the onboarding runbook stays unpinned on purpose: it is a
  one-shot bootstrap in a repository that has no stamp yet, and it should seed
  against the current release.
