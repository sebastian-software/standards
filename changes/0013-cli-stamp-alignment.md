# 0013 — Prove CLI and stamp alignment, and record unvalidated agent runs

- **Scopes:** node, rust
- **Standards version:** 13

## Intent

Make the version of `@sebastian-software/standards` a repository runs and the
version its `.repometa.json` is stamped at provably equal, and make an agent run
that pushed a result it could not validate visible to CI instead of
indistinguishable from a clean one.

## Problem

Two defects, one mechanism.

**The alignment was inferred, not proven.** `standards check` already compared
`.repometa.json#standards` against the running CLI's
`manifest.json#currentVersion`, but the comparison was symmetric, non-blocking,
and silently reversible: `standards apply` rewrote the stamp in **both**
directions, so a stale pinned CLI erased the very evidence of the mismatch and
then reported no drift. The failing population makes it worse — a repository
pinned to an old release runs a CLI whose manifest is old too, and no validation
shipped in a later release ever executes there. The fix therefore has to reach
the consumer through artifacts a _fresh_ CLI writes, not only through code in a
future release.

**Publication was treated as completion.** Since version 12 the pull-mode agent
always commits and pushes, deletes `.standards/pending.json` and hands over,
regardless of whether the repository's gate was green. That policy is right —
withholding work helps nobody — but it left no machine-readable difference
between a validated result and a best-effort one. The `pending.json` guard goes
green either way.

## Mechanical steps (covered by `standards apply`)

The CLI itself changes; three seeded or reference workflows change with it.

- `.standards/pending.json` gains **`cliVersion`**: the npm version of the CLI
  that produced the payload, read from its own `package.json`. Under Renovate's
  `postUpgradeTasks` that is the freshly resolved `dlx` CLI, so the field is
  correct even when the repository's installed CLI is stale — which is exactly
  the state it exists to repair. The field is additive: `schemaVersion` stays
  `1`, so a payload already in flight is never rejected.
- **`standards check` classifies its findings.** The version-stamp check is now
  directional. A repository behind its CLI is ordinary drift and exits `1`. A
  CLI behind its repository is a **blocking** finding — every other verdict of
  that run was computed against an outdated manifest — and exits `3`. `0` stays
  clean and `2` stays reserved for usage errors. `standards check --json` writes
  one object, `{ findings: [{ kind, path, detail, blocking }], total, blocking }`,
  and no prose, for callers that need the classes rather than the text.
- **`standards apply` no longer lowers the stamp** when the running CLI is older
  than the repository — unless `--from-version` was passed. That flag is the
  discriminator: Renovate always passes it and legitimately raises the stamp
  before the `dlx` CLI runs, so self-healing has to survive on that path or the
  migration pull request goes red with no payload and therefore no agent
  trigger. A human or agent invoking a stale pinned CLI directly passes nothing
  and hits the guard.
- **`reference/node/github-workflows-ci.yml`** and
  **`reference/node/forgejo-workflows-ci.yml`** gain, immediately before the
  `standards check` step, a `node -p` guard that resolves
  `@sebastian-software/standards/manifest.json` through `require.resolve` — over
  the repository root and the directories declared in
  `.repometa.json#workspaces`, so a nested install per change 0012 is found —
  and fails when its `currentVersion` differs from `.repometa.json#standards`.
  No `jq`: it is not guaranteed in the Forgejo node image.
- **All three workflows**, `reference/rust/ci.yml` included, gain a
  `.standards/blocked.json` guard right after the existing `pending.json` guard.
  It fails when that file exists with `blocking: true`. It is plain `grep`, so
  it needs neither `jq` nor `node_modules`.

`.standards/blocked.json` itself is written by the agent, never by
`standards apply`. Its schema, the meaning of `blocking`, and the rule for
deleting it are documented in `SKILL.md`; `BlockedState` and
`assertBlockedState` in this package are its authoritative definition.

## Judgement steps (agent work)

1. **Raise the pin to `pending.json#cliVersion`, first, before anything else.**
   Every `standards check` verdict in this migration is computed against the
   manifest of whichever CLI actually runs, so an unaligned run cannot validate
   its own work.

   Node-scope repositories set the devDependency exactly, no range:

   ```sh
   pnpm add --save-dev --save-exact @sebastian-software/standards@<cliVersion>
   ```

   In a nested workspace it belongs in the `package.json` the CI job installs
   from. Rust-only repositories raise the pinned `dlx` version in the CI
   workflow instead. Refresh the lockfile in the same commit, so
   `pnpm install --frozen-lockfile` installs what you pinned.

   Then verify on two independent values, and never infer compatibility from npm
   semver ordering: the installed `manifest.json#currentVersion` must equal
   `pending.json#toVersion`, and `.repometa.json#standards` must equal it too
   after `standards apply`. `standards check` exits `3` while they disagree.

   If you cannot complete this — the registry is unreachable, the resolution
   conflicts — still push your best-effort commits and write
   `.standards/blocked.json` with `blocking: true` and that reason.

2. **Merge the two new CI steps into the repository's existing workflow.** Both
   node workflows are _seeded_, not managed: `standards apply` writes them only
   when they do not exist, so a repository that already has a `ci.yml` receives
   nothing from the mechanical part. Copy the steps in by hand:

   - the `.standards/blocked.json` guard, immediately after the existing
     `Guard: agent step not yet completed for this PR` step;
   - the CLI/stamp alignment guard, immediately before the
     `pnpm exec standards check` step — after the install step, because it
     resolves the installed package, and late enough that a lint or test failure
     still shows up in the same run rather than being masked.

   Take both step bodies verbatim from
   [`reference/node/github-workflows-ci.yml`](../reference/node/github-workflows-ci.yml)
   or its Forgejo twin; keep every repository-specific job, matrix entry and
   environment variable around them untouched. A Rust-only repository takes only
   the blocked-marker guard, from
   [`reference/rust/ci.yml`](../reference/rust/ci.yml), into its `standards`
   job.

   A repository whose CI does not run `pnpm install --frozen-lockfile` before
   the drift lane has to add it, or the alignment guard cannot resolve the
   package.

## Notes

- `cliVersion` is read from the CLI's own `package.json#version` rather than
  published as a new `manifest.json` field. npm always ships `package.json`, and
  `package.json#files` already ships `manifest.json`, so nothing about the
  release pipeline changes.
- The two numbers are independent and both are needed. `cliVersion` alone cannot
  distinguish a `dlx`-fresh payload from one a stale local
  `apply --emit-pending` produced, which is why the verification also anchors on
  `toVersion`.
- The Renovate `postUpgradeTasks` invocation must carry
  `--config.minimum-release-age=0`, like every `dlx` of this package. Without
  the bypass pnpm 11 resolves a release up to 24 hours old and `cliVersion`
  records a lagging version. That is server configuration outside this
  repository; `SKILL.md` records it as a coordination item.
- Deleting `.standards/blocked.json` is the cheapest way to a green pipeline,
  which is the same failure class this change addresses for `pending.json`. The
  independent backstop is the alignment guard, which lives in a file the
  consumer owns. This package cannot enforce consumer branch content, and does
  not pretend to.
