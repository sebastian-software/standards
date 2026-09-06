# 0012 — Nested Node workspaces get the node scope

- **Scopes:** common, node
- **Standards version:** 12

## Intent

Let a repository whose Node workspace lives in a subdirectory receive the
node-scope files there, instead of receiving nothing and reporting no drift.

## Problem

Scope detection ran at the repository root only: `manifest.json#scopes.node.detect`
is `package.json`, and `detectScopes` tested for that file in the root. A
repository with no root `package.json` therefore never got the `node` scope,
and `standards check` stayed green while none of the Node-side files existed
anywhere (sebastian-software/standards#73).

Three repositories were in exactly that state on 2026-09-06:

| Repository | Node workspaces                                     | Missing                                                       |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------- |
| ferriki    | `node/`                                             | managed `.oxfmtrc.json`, seeded oxlint/eslint/tsconfig/cspell |
| ferromark  | `node/`, `scripts/`, `homepage/`                    | the same, in three places                                     |
| ferrolex   | `crates/ferrolex-node/`, `editors/vscode/ferrolex/` | the same, in two places                                       |

All three publish TypeScript packages from those directories. They were
formatted and linted by whatever each directory happened to configure — the
drift the node scope exists to prevent — and the gap was invisible, because the
CLI reported nothing.

## Mechanical steps (covered by `standards apply`)

`.repometa.json` gains an optional `workspaces` array of directories, relative
to the repository root:

```json
{
  "standards": 12,
  "visibility": "oss",
  "since": 2026,
  "platform": "github",
  "workspaces": ["node", "scripts"]
}
```

Scope detection then runs at the root as before **and** in each declared
directory. Two rules keep that from doing damage:

- **`common` never applies to a workspace.** It is repository-wide
  (`SECURITY.md`, the issue forms, the marker sections); a second copy inside
  `node/` would be wrong. Marker sections are skipped in a workspace for the
  same reason.
- **Only entries marked `workspace` in the manifest apply.** Per-package
  configuration — `.oxfmtrc.json` (managed), `eslint.config.ts`,
  `oxlint.config.ts`, `tsconfig.json`, `cspell.json` (seeded) — is written into
  the workspace. Repository-level entries — `renovate.json` and the CI
  workflows — stay at the root and are never duplicated.

Nothing is auto-discovered. A directory is managed because the repository
declares it, so a vendored upstream mirror (ferriki's
`node/compat/upstream/`, which carries fifteen `package.json` files) is never
touched by accident.

`standards check` reports a workspace file with its full path
(`node/.oxfmtrc.json`), and `apply` writes it there. The changelog selection
also follows: a Rust repository that declares a Node workspace now receives the
node-scope entries, including `0001`, which it never saw before.

`standards init --force` — the documented way to add `platform` to a legacy
stamp — now preserves `workspaces` and `exceptions` instead of dropping them.

## Judgement steps (agent work, node scope)

1. **Declare the workspaces.** Add `workspaces` to `.repometa.json` with the
   directories that hold a `package.json` the repository actually maintains.
   Not every `package.json` qualifies: a vendored mirror, a fixture, or a
   generated platform sidecar is not a workspace the standards manage. For the
   three repositories above that is `["node"]`, `["node", "scripts", "homepage"]`
   and `["crates/ferrolex-node", "editors/vscode/ferrolex"]` — verify against
   the repository before writing it down.
2. **Run `apply`, then read the diff.** The workspace now receives a managed
   `.oxfmtrc.json` and, where they are missing, the seeded configs. A
   hand-written `eslint.config.js` (ferriki's, for example) is **not** the
   seeded `eslint.config.ts`, so `apply` writes the seed next to it: merge the
   two and delete the one that is no longer the entry point, rather than
   leaving a repository with both.
3. **Point the scripts at the right directory.** A workspace that now has its
   own `.oxfmtrc.json` should be formatted from that directory, so the config
   applies. Where the repository formats everything from the root, keep one
   root-level run and make sure the workspace's config is the one it picks up
   for those files.
4. **Do not declare the repository root.** `"workspaces": ["."]` is not the way
   to get root files; the root is always detected. A `.` entry is rejected.
5. **This is the first node-scope version several Rust repositories receive.**
   Their pending payload now contains `changes/0001` onward for the node scope.
   Read them: `0001` is the Prettier-to-oxfmt migration, and a nested workspace
   that still runs Prettier has to make that move like any other Node package.

## Notes

- The alternative design — detecting `<dir>/package.json` for a hard-coded list
  of candidate directories — needed the same per-entry distinction between
  package-level and repository-level files, and would have guessed at which
  directories count. The declaration is the part that carries the weight, so it
  is the part that is explicit.
- The `rust` scope has no `workspace` entries. A Cargo workspace is rooted at
  the repository root by definition, and `rustfmt.toml`, `deny.toml` and
  `rust-toolchain.toml` belong there. A nested Cargo workspace (a `fuzz`
  directory, for example) is deliberately out of scope.
- `workspaces` paths are validated: relative, forward slashes, no empty, `.` or
  `..` segment. The value ends up in file paths, so it stays inside the
  repository.
