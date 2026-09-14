# 0016 — Shared CI checks and resumable local migrations

- **Scopes:** common, node, rust
- **Standards version:** 16

## Intent

Use one CLI implementation for pending markers, blocked markers, exact pins and
file drift. Keep interrupted local migrations resumable, and make previews
read-only.

## Mechanical changes

The Node workflow references now call `pnpm exec standards ci`. The Rust
reference calls the same command through its pinned `dlx` version and explicitly
selects pnpm, because Rust-only repositories have no `packageManager` field.
Existing seeded workflows remain untouched by `apply`.

`sync` persists `.standards/pending.json` before applying files, resumes its
original baseline, includes declared nested workspaces and retains the marker
after failure. `sync --dry-run` no longer writes files. `apply` scans for nested
Oxfmt configs only when a repository has extra ignore patterns to migrate.

## Judgement steps

1. Raise the installed CLI pin and lockfile to the release that produced this
   migration's pending payload. Verify it ships manifest version 16 or newer.
2. In each standards CI lane, replace the inline pending/blocked/alignment/pin
   guards and final `standards check` with `standards ci`. Keep the existing
   locked install and job permissions. For Rust-only repositories, preserve an
   exact `dlx` pin and give `pnpm/action-setup` an explicit version input.
3. Keep the normal code gate separate. While an agent is working, use
   `standards check`; `ci` intentionally fails while pending work remains.
4. Preserve any old required `check` job as an aggregate until branch protection
   requires `CI / Check` and `Standards / Consistency`. Change repository
   settings together with the workflow, never by renaming jobs alone.
5. Confirm both Renovate presets are present. Rust workflow CLI pins are now
   supported by the shared standards preset; remove a matching local regex
   manager only after that preset update is available.

## Verify and recover

Run the repository's code gate and `standards ci`. A valid non-blocking agent
marker is reviewer context; pending, malformed and blocking markers fail CI.
Old CLIs reject the new command, so update the CLI before removing old guards.
To resume a failed local migration, rerun `standards sync` with the same agent.
See [the CLI guide](../docs/cli.md) for recovery after a plain `apply`.
