# 0014 — Verify that the standards CLI pin is an exact version literal

- **Scopes:** node
- **Standards version:** 14

## Intent

Make the _shape_ of the `@sebastian-software/standards` pin part of the
alignment contract, so a repository is not only told that its CLI and its stamp
disagree but is also verifiably able to make them agree.

## Problem

Since version 13, `standards check` proves that `.repometa.json#standards`
equals the installed `manifest.json#currentVersion`. Nothing proved that the
repository could ever reach that state. A consumer declaring a range such as
`^0.2.0` is locked below every release that would satisfy its own stamp: the
blocking stamp mismatch fires on every run, and its advice — raise the pin —
cannot be followed by any automated path. Change 0011 already said "do not use a
range", but only as a judgement step an agent had to remember.

A range is not the only offender. `latest`, an `npm:` alias, `catalog:`,
`workspace:*`, `file:` and `link:` references and URLs all leave the installed
version to something other than a reviewed, exact pin, and none of them is a
range.

## Mechanical steps (covered by `standards apply`)

The CLI itself changes; the two seeded node workflows change with it.

- **`standards check` reports a new blocking finding kind, `pin`**, and exits
  `3`. The kind is the pin-shape member of the alignment class and fires in two
  cases:
  - _shape_ — a `package.json` declares `@sebastian-software/standards` in
    `devDependencies` or `dependencies` with anything but a bare exact version
    literal (`0.11.1`, `1.2.3-rc.1`, `1.2.3+build.5`). It fires whether or not
    the repository runs the CLI in CI.
  - _absent_ — no examined `package.json` declares the CLI, and a workflow file
    directly in `.github/workflows/` or `.forgejo/workflows/` mentions
    `standards check` or `@sebastian-software/standards`. Without such a lane it
    stays silent, so a Rust project with a Node build harness is not told to
    declare a CLI it never runs.

  The root and every directory in `.repometa.json#workspaces` are examined, as
  far as their `package.json` can be parsed. A repository in which any examined
  `package.json#name` is the CLI's own package name is exempt as a whole. A
  specifier containing `://` is reported by its scheme only, so a credential in
  a URL never reaches a log.

- **`package.json` is neither managed nor seeded, so `standards apply` does not
  repair a `pin` finding.** Unlike a stale CLI, a wrong pin shape does not make
  `apply` or `sync` refuse to write: a current CLI's references are still right.
  Both are members of the **alignment class** — exit code `3` is common to
  both, write refusal belongs to the stamp mismatch only.
- **The blocking stamp finding names a non-exact declared specifier** and the
  form it has to take, in `check`, `apply` and `sync` alike.
- **`.standards/blocked.json#blocking`** covers both members. For the pin-shape
  member `expectedCliVersion` and `observedCliVersion` may agree; `reason` says
  which member blocked. `schemaVersion` stays `1`.
- **`reference/node/github-workflows-ci.yml`** and
  **`reference/node/forgejo-workflows-ci.yml`** extend the alignment guard: after
  proving the manifest version, the same `node -p` script reads the
  `package.json` of the root and of every directory in
  `.repometa.json#workspaces`, and fails when a declaration is not a bare exact
  version literal or when none declares the CLI. No `jq`.

## Judgement steps (agent work)

1. **Make the pin an exact version literal.** Where `standards check` reports a
   `pin` finding for a declaration, set its specifier to an exact version in
   that same `package.json` and dependency field. Keep the version the lockfile
   resolves today unless another step of this migration names a different one —
   this step fixes the shape, not the version. Where the finding reports that no
   `package.json` declares the CLI, add an exact devDependency to the one the CI
   job installs from, running this in that directory:

   ```sh
   pnpm add --save-dev --save-exact @sebastian-software/standards@<version>
   ```

   Refresh the lockfile in the same commit, and never infer compatibility from
   npm semver ordering.

2. **A `catalog:` declaration moves out of the catalog.** Remove
   `@sebastian-software/standards` from the `catalog` in `pnpm-workspace.yaml`
   and declare it as an exact `devDependencies` entry in the `package.json` the
   CI job installs from. The same applies to `workspace:*` in a repository that
   does not vendor the CLI itself.

3. **Merge the extended alignment guard into the repository's existing
   workflow.** Both node workflows are _seeded_, not managed, so a repository
   that already has a `ci.yml` receives nothing from the mechanical part. Replace
   the body of the `Guard: the pinned standards CLI matches the repository stamp`
   step with the one from
   [`reference/node/github-workflows-ci.yml`](../reference/node/github-workflows-ci.yml)
   or its Forgejo twin, verbatim. The extended guard catches what the CLI cannot:
   a repository whose `ci.yml` has been re-seeded but whose pinned CLI is still
   too old to carry the `pin` finding.

4. If the pin cannot be made exact, push your best-effort commits and write
   `.standards/blocked.json` with `blocking: true` and a `reason` naming the
   specifier class (a range, a `catalog:` reference, a URL) — never a URL
   specifier or the credentials it may carry.

## Notes

- The finding is preventive. It cannot execute in a repository already stranded
  on an older CLI — the bootstrap limit change 0013 already concedes — which is
  why the consumer-owned CI guard is extended too.
- Two units declaring _different_ exact versions are not a finding; the
  alignment guard proves the installed manifest against the stamp either way.
- Rust-only repositories pin the CLI in a workflow `dlx` argument. Its shape is
  not machine-checked; see
  [`reference/rust/README.md`](../reference/rust/README.md).
- This repository's own `ci.yml` is bespoke and carries no alignment guard, so
  step 3 is a no-op here.
