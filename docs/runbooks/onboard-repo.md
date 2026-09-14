# Bring a repository onto standards

Start here when a repository has no `.repometa.json`. For a repository already
using standards, follow [update and recovery](../cli.md) instead. This guide
targets the CLI release shipping standards version 16 or newer.

| Starting point           | Path                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| New Node repository      | Use [repo-template](https://github.com/sebastian-software/repo-template), then its getting-started guide     |
| Existing Node repository | Follow steps 1–5 below; review the baseline toolchain migration                                              |
| Rust-only repository     | Follow the same steps with an exact `pnpm dlx` CLI version; see [Rust setup](../../reference/rust/README.md) |

You need a working branch, Node.js 24 or newer, pnpm, and repository settings
access for the final automation setup. Local agent execution additionally needs
`claude` or `codex` installed and authenticated. Previewing needs neither agent.

## 1. Choose the CLI and repository metadata

For a Node project with a root `package.json`, install the reviewed CLI release:

```sh
pnpm add --save-dev --save-exact @sebastian-software/standards@<version>
pnpm exec standards init --platform github --visibility oss --since <year>
```

Replace the placeholders. Use `forgejo` for that platform, `private` for an
internal repository, and the project's original creation year. `init` prompts
for missing values; `--yes` enables non-interactive use. It starts the standards
stamp at `0`. Do not use `init --force` merely to change one metadata field:
edit that field in `.repometa.json` and preserve the migration stamp.

For a Rust-only project, omit the Node dependency and run the same CLI through
an exact version for every command:

```sh
pnpm --config.minimum-release-age=0 dlx @sebastian-software/standards@<version> init \
  --platform github --visibility oss --since <year>
```

The release-age override allows an explicitly selected fresh release. Keep
that exact version in the Rust workflow too; pnpm needs an explicit version in
`pnpm/action-setup` when no `packageManager` field exists.

### A Node package below the repository root

Install the exact dependency in its package directory, and declare its path in
the root `.repometa.json` before applying standards:

```json
{
  "standards": 0,
  "visibility": "oss",
  "since": 2026,
  "platform": "github",
  "workspaces": ["node"]
}
```

Commands still target the repository root. If the root cannot resolve the
nested CLI, invoke the same reviewed exact version through `pnpm dlx`.
Only workspace-marked configuration is applied inside declared packages;
repository-wide files stay at the root. See [scopes and ownership](../standards-model.md).

### A generated README

Before the first apply, choose the README owner. Native mdtheme users set
`"readme": { "owner": "mdtheme" }`, keep `README.md.src` and exactly one root
`mdtheme.yaml` or `mdtheme.yml`, and generate `README.md` with the pinned tool.
Remove any old standards branding section from that generated output through
its source/generator. Standards then checks ownership prerequisites and leaves
the whole README to mdtheme.

The legacy `markdown-themer` owner is also supported. Its source, configuration,
package scripts and output must satisfy the
[README ownership contract](../adr/generated-readme-ownership.md).
Without an explicit owner, standards manages its branding marker section only.

## 2. Preview and complete the initial migration

From the repository root:

```sh
pnpm exec standards sync --dry-run
pnpm exec standards sync --agent codex
```

The preview writes nothing. The actual sync first records the migration
baseline, applies managed files and missing seeds, then runs the agent on the
applicable numbered migrations. It leaves a working-tree diff for review.
If it fails or is interrupted, rerun sync; keep `.standards/pending.json` until
the work is complete. See [recovery](../cli.md#resume-an-interrupted-sync).

For manual migration, read the applicable [changes](../../changes/), run
`standards apply --from-version 0 --emit-pending .standards/pending.json`, and
complete each judgement step. Run `standards check` and the repository's code
gate, then remove the pending marker when those steps are complete.

For an existing project, the [baseline migration](../../changes/0001-baseline.md)
can involve replacing Prettier, reconciling lint configuration and adapting
package scripts. Existing seeded files are preserved; compare them with the
references explicitly. Record intentional manual deviations in
`.repometa.json#exceptions`. Exceptions guide the reviewer/agent; they do not
suppress managed-file checks.

## 3. Validate and review the result

```sh
pnpm agent:check
pnpm exec standards ci
git diff
```

Use the project's own code gate if it has no `agent:check`. For Rust projects,
also run the checks listed in [Rust setup](../../reference/rust/README.md).

`standards ci` is available with standards version 16 and newer. Older CLI
releases require their seeded pending, blocked and alignment guards plus
`standards check`; raise the exact CLI pin before replacing those guards.
The pending marker intentionally keeps CI red during an incomplete migration.
A successful standards check alone does not prove the code build/tests passed.

## 4. Enable Renovate and the external agent

Use both presets in `renovate.json` on GitHub and Forgejo:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>sebastian-software/renovate-config",
    "github>sebastian-software/renovate-config:standards"
  ]
}
```

Set the `managed-deps` repository topic and confirm the self-hosted Renovate
worker can access the repository. The topic enables discovery; the presets
supply policy. Merge any Renovate onboarding PR after checking those presets.

The worker must allow the standards post-upgrade command. It applies files
and writes a pending marker; an external agent performs judgement work.
Configure that agent separately using [the agent contract](../../SKILL.md).
See the [rollout guide](https://github.com/sebastian-software/renovate-config/blob/main/docs/standards-rollout.md)
for the worker prerequisites and the two independent updates:

- The integer standards stamp triggers the migration PR and pending work.
- The npm CLI version is updated as a separate dependency. A migration may
  need to raise that pin before it can validate the new stamp.

Do not assume these updates arrive in one PR. The final migration merge is a
human step. Avoid Renovate's rebase/retry checkbox after agent work unless you
intend to recreate the branch and repeat the migration.

## 5. Finish repository settings

After the workflow has run, configure branch protection on `main` to require
its actual check names. The reference lanes are `CI / Check` and
`Standards / Consistency`. A repository already requiring `check` must keep
that aggregate job until protection is migrated. Confirm the workflow and
required contexts together; a renamed job can otherwise block every PR.
See [branch protection](../../SKILL.md#branch-protection-setup).

Also:

- Apply [the label taxonomy](../labels.md) to this repository.
- For GitHub repositories, enable private vulnerability reporting if the
  project's security policy links to it. Until enabled, keep the published
  security contact available.
- Check repository URLs in seeded issue forms, security documentation and
  package metadata. They are editable seeds after creation.

## Troubleshooting

| Symptom                                               | First check                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| No Renovate PR                                        | Exact `managed-deps` topic, worker access and both presets          |
| Drift PR has no mechanical changes or pending payload | Worker logs and its allowed post-upgrade command                    |
| No Node configuration appears                         | Root `package.json`, or declared `.repometa.json#workspaces`        |
| Platform is missing                                   | Add `platform` to the existing metadata without resetting its stamp |
| Pin or stamp failure (exit 3)                         | Installed CLI version, exact dependency declaration and lockfile    |
| Pending marker remains                                | Resume sync or finish manual steps; inspect any blocked marker      |
| Required check never reports                          | Compare branch protection with the actual workflow job names        |
