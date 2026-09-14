# Check, update, and recover a repository

Use these commands from a standards-managed repository containing
`.repometa.json`. Node consumers install the CLI as an exact devDependency;
Rust-only consumers use a reviewed exact version with `pnpm dlx`.
Commands below use the Node installation. Add `--cwd <directory>` to target
another checkout.

## Choose a command

| Command                    | What it does                                                                        | Writes files? |
| -------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `standards init`           | Creates the repository metadata                                                     | Yes           |
| `standards check`          | Compares files and metadata with the installed CLI                                  | No            |
| `standards ci`             | Checks agent markers, then runs the same drift and pin checks                       | No            |
| `standards apply`          | Restores managed files, creates missing seeds, updates owned sections and the stamp | Yes           |
| `standards sync --dry-run` | Prints the pending migration prompt                                                 | No            |
| `standards sync`           | Applies files and runs an agent on pending migrations                               | Yes           |

Read-only previews, resumable sync and `ci` are available in the release
shipping standards version 16 and newer.
An older CLI rejects the command; it cannot silently skip these guards.
Existing consumers must update their pin before switching their workflow.

`apply` handles file mechanics. It does not update package dependencies,
rewrite existing seeded workflows, or prove that manual migration steps ran.
`sync` handles those remaining steps through `claude` (default) or `codex`.

## Update a consumer

1. Start from a clean working branch. Review the target release and its
   [numbered migrations](../changes/).
2. Update the CLI pin. Replace `<version>` with that release's exact npm version:

   ```sh
   pnpm add --save-dev --save-exact @sebastian-software/standards@<version>
   ```

   In a nested Node workspace, run this in the package directory that owns the
   dependency. Commit its lockfile with the pin. If pnpm's release-age policy
   blocks a reviewed release published today, add
   `--config.minimum-release-age=0` to this invocation.

3. Return to the repository root and preview the work:

   ```sh
   pnpm exec standards sync --dry-run
   ```

4. Run the selected agent, then validate and review its changes:

   ```sh
   pnpm exec standards sync --agent codex
   pnpm agent:check
   pnpm exec standards ci
   git diff
   ```

   Use the repository's own quality command if it has no `agent:check` script.
   The CLI checks its standards contract; the repository gate checks its code.

For a Rust-only repo, update the exact CLI version in its workflow and use
`pnpm --config.minimum-release-age=0 dlx @sebastian-software/standards@<version>`
in place of `pnpm exec standards`. Keep that version consistent throughout
the migration. The [shared Renovate preset](https://github.com/sebastian-software/renovate-config)
also discovers these workflow pins.

## Resume an interrupted sync

Rerun `standards sync --agent codex` (or the agent you selected). The pending
marker retains the original migration baseline even after `apply` has advanced
the stamp. A newer compatible CLI includes both the retained work and newer
applicable migrations. An unreadable marker or one targeting a newer CLI is
an error; preserve it while repairing the cause.

A successful agent exit clears the pending marker only after the standards
check passes and no blocking marker remains. A failed agent exit, failed
standards check, or failed mechanical apply leaves the work resumable. The
CLI does not rerun the repository's entire build/test gate itself; the agent
and CI remain responsible for those checks.

If you previously ran plain `apply` without preserving a baseline, read the
old stamp from Git and create a pending marker explicitly:

```sh
pnpm exec standards apply --from-version <old-integer> --emit-pending .standards/pending.json
pnpm exec standards sync --agent codex
```

`--from-version` also permits the Renovate path to reconcile a stamp already
raised by Renovate. Use the original integer, not the npm package version.

## Understand failures

| Result                             | Meaning                                                                | Next action                                                |
| ---------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `check`: exit `0`                  | Files, stamp and pin match this CLI                                    | Run the repository's code checks                           |
| `check`: exit `1`                  | Ordinary drift, or an invalid/unreadable input                         | Read the output; apply or repair the reported input        |
| `check`: exit `3`                  | CLI is older than the stamp, or the dependency pin is absent/non-exact | Repair the pin and lockfile before validating              |
| `ci`: exit `1` before drift checks | Pending work, blocking agent result, or invalid marker                 | Resume the migration or repair the marker's reported cause |
| `sync`: nonzero                    | Apply, agent startup, agent work or final standards validation failed  | Fix the reported cause and rerun sync                      |

`check --json` emits one findings object to stdout. `ci --json` emits that same
object when marker checks pass; marker failures are reported on stderr first.
Do not use `standards ci` as the agent's in-progress check: the pending marker
intentionally prevents it from passing until migration work is complete.
