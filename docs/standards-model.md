# How standards works

Standards separates repeatable file updates from migration decisions. The CLI
uses only the references bundled in its installed package; `check` does not
contact the network to discover a newer release.

## Two version numbers

| Value                                  | Purpose                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| npm package version, such as `0.12.0`  | Selects the exact CLI code and references to install                  |
| `.repometa.json#standards`, an integer | Records the applied reference version and selects numbered migrations |

The installed `manifest.json#currentVersion` must match the consumer's stamp
for a clean check. Several CLI releases can ship the same standards integer.
A CLI repair therefore need not force every repository through a migration.

A stamp records the mechanical baseline. It does not prove that an agent or
person completed every judgement step. `.standards/pending.json` records
unfinished migration work; CI must check both.

## File ownership

| Kind           | `apply` behavior                      | Where to customize                                                      |
| -------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Managed        | Restores the exact reference contents | Change standards, or use the supported local extension point            |
| Seeded         | Creates a file only when missing      | Edit the consumer's file; later migrations explain required adaptations |
| Section        | Replaces only a marked block          | Edit outside the markers                                                |
| Reference-only | Never installed automatically         | Copy and adapt deliberately, such as release workflows                  |

For example, `.oxfmtrc.json` is managed. Repository-specific formatter ignores
belong in `.prettierignore`. Existing CI workflows are seeded, so updating
standards does not silently overwrite project-specific jobs.

A generated README can delegate ownership to mdtheme through
`readme.owner: "mdtheme"`. Standards checks the static prerequisites and leaves
rendering to the pinned generator. See [README composition](../reference/mdtheme/README.md).

## Scopes and nested workspaces

The root always receives `common`. A root `package.json` enables `node`, and a
root `Cargo.toml` enables `rust`. A nested package must be declared explicitly:

```json
{
  "standards": 16,
  "visibility": "oss",
  "since": 2026,
  "platform": "github",
  "workspaces": ["node"]
}
```

Only per-package entries marked `workspace` in [manifest.json](../manifest.json)
are applied inside those directories. Repository-wide workflows, Renovate
configuration and owned sections stay at the root. The CLI and agent migration
selection use the same declared scopes.

`exceptions` in repository metadata provides context to the migration agent.
It does not disable deterministic file or pin checks.

## Automated updates

Consumers extend both shared Renovate presets and carry the `managed-deps`
topic for the self-hosted worker. The standards preset detects the published
standards integer. Its post-upgrade task applies file changes and writes the
pending marker. The migration agent aligns the CLI pin and lockfile, handles
judgement steps, and leaves a reviewable result for a human to merge.

This post-upgrade command requires a worker that permits it. Without that
capability, the update still needs a local migration using
[the CLI guide](cli.md). Adding a preset alone does not run an agent.

A normal npm update of the CLI is a separate Renovate dependency from the
integer stamp. If it changes the bundled standards version, the PR needs the
same migration before CI can pass. Do not repair this by weakening the stamp
check. [renovate-config](https://github.com/sebastian-software/renovate-config)
owns the update rules and worker prerequisites; [SKILL.md](../SKILL.md) owns
the external agent's marker, label and review contracts.
