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
```

Node repositories consume this package as a devDependency; other stacks run it
via `pnpm dlx @sebastian-software/standards check`.

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
