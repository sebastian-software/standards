# @sebastian-software/standards

[![Powered by Sebastian Software](https://img.shields.io/badge/Powered%20by-Sebastian%20Software-00718d?style=flat-square)](https://oss.sebastian-software.com)
[![CI](https://github.com/sebastian-software/standards/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastian-software/standards/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The single source of truth for repository standards across the
`sebastian-software` org — reference files, migration changelogs, agent
instructions and a CLI to check and apply them.

## The three repositories

The system is three small repos with sharply separated jobs, plus whatever
Renovate you already run:

```mermaid
flowchart TB
    RC["renovate-config<br/>— the update rules"]
    ST["standards<br/>— source of truth"]
    TPL["repo-template<br/>— starts new repos"]
    RN{{"Renovate<br/>self-hosted or Mend"}}
    REPOS["Managed repos<br/>(topic: managed-deps)"]
    AGENT["LLM agent<br/>judgement work"]

    ST -->|new version| RN
    RC -->|preset / rules| RN
    RN -->|bump PR + apply| REPOS
    TPL -.->|use this template| REPOS
    REPOS -.->|pending.json| AGENT
    AGENT -.->|commit on branch| REPOS
```

- **`standards`** (this repo) — the source of truth: reference files, the
  version stamp, migration changelogs and the CLI. The payload Renovate ships.
- **[`renovate-config`](https://github.com/sebastian-software/renovate-config)** —
  one shared Renovate preset that says _how_ updates behave (what automerges,
  what groups). The only org-specific configuration.
- **[`repo-template`](https://github.com/sebastian-software/repo-template)** —
  the GitHub template new repos start from; it consumes both of the above.

## How it works

Every managed repository carries a `.repometa.json` stamp:

```json
{ "standards": 3, "visibility": "oss", "since": 2026, "platform": "github" }
```

This package defines the current standards version ([manifest.json](manifest.json)),
the reference files per scope (`reference/common`, `reference/node`,
`reference/rust`) and one migration changelog per version bump (`changes/`).
Drift detection is a cheap, deterministic version comparison; applying updates
is split between the CLI (mechanics) and an agent following [SKILL.md](SKILL.md)
(judgement).

## CLI

```bash
standards init    # create .repometa.json interactively in a fresh repo
                  #   --visibility oss|private   skip the prompt for visibility
                  #   --since <int>              skip the prompt for the initial year
                  #   --yes                      non-interactive (use defaults / flags only)
                  #   --force                    overwrite an existing .repometa.json
standards check   # report drift, exit 1 if any (part of agent:check)
standards apply   # write managed files, seed missing ones, update branding, bump stamp
                  #   --from-version <int>    explicit baseline for pending-marker selection
                  #   --emit-pending <path>    write a JSON marker describing pending judgement work
standards sync    # apply + run an agent (claude or codex) locally on the pending changelog entries
```

All managed repositories invoke this package via
`pnpm dlx @sebastian-software/standards`; no devDependency installation is
required, regardless of stack. Every such invocation must carry
`--config.minimum-release-age=0` — pnpm 11 defaults `minimumReleaseAge` to 24h,
so without the bypass `dlx` resolves a version older than the one `apply` used
to write the stamp, and `check` then reports false drift right after a release.

## Renovate-driven workflow

The system is split so that _any_ Renovate setup can keep repos current — the
deterministic half needs no special server features, and the agent half plugs in
where it fits your infrastructure.

**Deterministic half — works with any Renovate, including the hosted Mend app.**
Renovate detects that a repo's `.repometa.json#standards` stamp is behind the
package's `manifest.json#currentVersion` and opens a bump PR. The repo's own CI
runs `standards check` (part of `agent:check`), so drift always surfaces as a red
check. The mechanical sync is `standards apply` — byte-exact for managed files,
seed-once for adaptable ones, marker-based for the README branding.

**Judgement half — an LLM agent.** Changelog steps that need judgement are
carried out by an agent, in one of two ways:

- **Local / interactive:** `standards sync` runs `apply` and then spawns
  `claude` or `codex` on the pending changelog entries. Works anywhere.
- **Fully automated (self-hosted Renovate):** a `postUpgradeTasks` step runs
  `standards apply --from-version {{currentValue}} --emit-pending .standards/pending.json`
  on the upgrade branch. The PR then carries all mechanical changes plus a JSON
  marker that an external agent (OpenClaw, Claude Code, Codex) picks up in pull
  mode and commits its judgement changes onto the same branch.

> [!NOTE]
> The hosted Mend app cannot run `postUpgradeTasks`, so the fully-automated pull
> model requires self-hosted Renovate. With Mend, use the deterministic half plus
> `standards sync` (locally or from a CI job triggered by the bump PR).

The version model is deliberately stack-agnostic: Renovate reads
`manifest.json#currentVersion` as an integer via a custom datasource, so Rust,
docs-only or mixed repos never see an npm semver. See
[`renovate-config`](https://github.com/sebastian-software/renovate-config) for
the shared preset and the self-hosted worker configuration, and
[changes/0002-renovate-pending.md](changes/0002-renovate-pending.md) for the full
server-side contract.

## File ownership

| Kind        | Meaning                                              | Examples                          |
| ----------- | ---------------------------------------------------- | --------------------------------- |
| **managed** | byte-exact, overwritten on apply                     | `.oxfmtrc.json`                   |
| **seeded**  | created once, repos may adapt them                   | `SECURITY.md`, `eslint.config.ts` |
| **section** | marker-delimited README block owned by the standards | branding footer                   |

The `common` scope seeds the community baseline — `SECURITY.md`,
`CODE_OF_CONDUCT.md`, `SUPPORT.md`, a `CLAUDE.md` pointer at `AGENTS.md`, and on
GitHub `.github/CODEOWNERS`, the three issue forms with their `config.yml`, and
`.github/pull_request_template.md`. Because they are seeded, a repository that
already has its own text keeps it; the merge strategy lives in
[changes/0008-common-community-files.md](changes/0008-common-community-files.md),
and the private reporting routes those files name in
[changes/0010-private-reporting-routes.md](changes/0010-private-reporting-routes.md).

The `rust` scope adds a managed `rustfmt.toml` plus seeded `rust-toolchain.toml`
and `deny.toml`, and ships CI and publish workflow skeletons as reference files.
The edition, MSRV, license and Cargo metadata policy behind them is written down
in [`reference/rust/README.md`](reference/rust/README.md).

## Label taxonomy

One issue taxonomy for the whole org, shipped as data in
[`reference/common/labels.json`](reference/common/labels.json):

| Group         | Labels                                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| **type**      | `type:bug`, `type:feature`, `type:docs`, `type:chore`                        |
| **priority**  | `priority:P0` (drop everything) … `priority:P3` (backlog)                    |
| **area**      | `area:<subsystem>` — the prefix is org-wide, the values are per repo         |
| **workflow**  | `epic`, `cross-repo`, `good first issue`, `dependencies`, `question`         |
| **standards** | `standards:needs-agent`, `standards:needs-review` (see [SKILL.md](SKILL.md)) |

Issues labeled `epic` use the title convention `Epic: …`. The seeded issue forms
apply `type:bug`, `type:feature` and `question` automatically.

The CLI does not manage labels — applying them is a one-shot `gh` call per repo:

```bash
# create or update every label from the taxonomy
jq -r '.labels[] | [.name, .color, .description] | @tsv' reference/common/labels.json |
  while IFS=$'\t' read -r name color description; do
    gh label create "$name" --color "$color" --description "$description" --force
  done
```

Rename the existing per-repo spellings instead of recreating them, so open
issues keep their labels:

```bash
gh label edit "priority:low" --name "priority:P3"
```

| Existing label                          | Taxonomy                                  |
| --------------------------------------- | ----------------------------------------- |
| `priority:P0` (ferriki)                 | unchanged                                 |
| `priority:low` (ferrolex)               | `priority:P3`                             |
| `priority: P2` (dalo, with space)       | `priority:P2`                             |
| `P3` (palamedes)                        | `priority:P3`                             |
| `category:<x>`                          | `area:<x>`                                |
| `bug` / `enhancement` / `documentation` | `type:bug` / `type:feature` / `type:docs` |

The full mapping is the `migrations` array in `labels.json`.

## Optional release blueprints

Repositories that intentionally release several Rust crates, npm packages, or
both as one version can start from the
[Release Please product templates](reference/release-please/README.md). The
guide covers Node, Rust, and mixed Rust/Node layouts, initial history setup,
publishing gates, and a publishing-free validation flow.

These templates are packaged as references but are deliberately not managed or
seeded by `standards apply`: choosing one shared product version instead of
independent package releases is a repository-level compatibility decision.

The workflow that runs them is
[`reference/release-please/publish-skeleton.yml`](reference/release-please/publish-skeleton.yml),
and the release steps every repository used to hand-write are shared composite
actions in this repository — `publish-crates`, `publish-npm`, `napi-matrix` and
`check-action-pins`, documented in
[`.github/actions/README.md`](.github/actions/README.md). Consumers reference
them by commit SHA:

```yaml
- uses: sebastian-software/standards/.github/actions/publish-crates@<sha> # v0.9.0
```

## Development

```bash
pnpm install
pnpm agent:check   # lint + format + typecheck + build + test + self-check
```

This repository applies its own standards (`standards check` runs against it
in CI).

## Onboarding a new repo

The step-by-step procedure for adding a new repo to the standards system
(new repo or legacy migration, GitHub or Forgejo) lives in
[`docs/runbooks/onboard-repo.md`](docs/runbooks/onboard-repo.md).

## License

[MIT](LICENSE)

---

<!-- sebastian-software-branding:start -->

<p align="center">
  <a href="https://oss.sebastian-software.com">
    <img src="https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg" alt="Sebastian Software" width="240" />
  </a>
</p>

<p align="center">
  <strong>Built by Sebastian Software</strong> — consulting for TypeScript, React &amp; Rust.<br />
  <a href="https://sebastian-software.de">Work with us</a> · <a href="https://oss.sebastian-software.com">More open source</a>
</p>

<p align="center">Copyright &copy; 2026 Sebastian Software GmbH</p>

<!-- sebastian-software-branding:end -->
