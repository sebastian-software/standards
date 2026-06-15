# @sebastian-software/standards

[![Powered by Sebastian Software](https://img.shields.io/badge/Powered%20by-Sebastian%20Software-00718d?style=flat-square)](https://oss.sebastian-software.com)
[![CI](https://github.com/sebastian-software/standards/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastian-software/standards/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The single source of truth for repository standards across the
`sebastian-software` org — reference files, migration changelogs, agent
instructions and a CLI to check and apply them.

## How it works

Every managed repository carries a `.repometa.json` stamp:

```json
{ "standards": 1, "visibility": "oss", "since": 2026 }
```

This package defines the current standards version ([manifest.json](manifest.json)),
the reference files per scope (`reference/common`, `reference/node`,
`reference/rust`) and one migration changelog per version bump (`changes/`).
Drift detection is a cheap, deterministic version comparison; applying updates
is split between the CLI (mechanics) and an agent following [SKILL.md](SKILL.md)
(judgement).

## CLI

```bash
standards check   # report drift, exit 1 if any (part of agent:check)
standards apply   # write managed files, seed missing ones, update branding, bump stamp
                  #   --from-version <int>    explicit baseline for pending-marker selection
                  #   --emit-pending <path>   write a JSON marker describing pending judgement work
standards sync    # apply + run an agent (claude or codex) locally on the pending changelog entries
```

Node repositories consume this package as a devDependency; other stacks run it
via `pnpm dlx @sebastian-software/standards check`.

## Renovate-driven workflow

A self-hosted Renovate server can drive standards updates across the org without
per-repo schedulers and without stack-specific paths. The Renovate worker runs
`standards apply --from-version {{currentValue}} --emit-pending .standards/pending.json`
on the upgrade branch; the resulting PR contains all mechanical changes plus a
JSON marker that an external LLM agent (OpenClaw, local Claude Code, Codex)
picks up in pull mode to apply the judgement-driven changelog steps.

See [changes/0002-renovate-pending.md](changes/0002-renovate-pending.md) for the
server-side prerequisites (custom datasource on `manifest.json#currentVersion`,
allowed-commands pinning, per-repo opt-in via `.repometa.json`).

## File ownership

| Kind        | Meaning                                              | Examples                            |
| ----------- | ---------------------------------------------------- | ----------------------------------- |
| **managed** | byte-exact, overwritten on apply                     | `.oxfmtrc.json`, `.oxfmtignore`     |
| **seeded**  | created once, repos may adapt them                   | `eslint.config.ts`, `tsconfig.json` |
| **section** | marker-delimited README block owned by the standards | branding footer                     |

## Development

```bash
pnpm install
pnpm agent:check   # lint + format + typecheck + build + test + self-check
```

This repository applies its own standards (`standards check` runs against it
in CI).

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
