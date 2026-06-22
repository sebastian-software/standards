# 0005 — oxfmt ignores move into `.oxfmtrc.json` `ignorePatterns`

- **Scopes:** node
- **Standards version:** 5

## Intent

Drop the standalone `.oxfmtignore` file and express the formatter's ignore
list through the `ignorePatterns` key inside the managed `.oxfmtrc.json`.

## Problem

oxfmt has no concept of an `.oxfmtignore` file. By default it only
auto-discovers `.gitignore` and `.prettierignore`
([oxc.rs ignore files](https://oxc.rs/docs/guide/usage/formatter/ignore-files.html)).
The previous baseline shipped a `.oxfmtignore` and made it work by passing
`--ignore-path .oxfmtignore` in the `format` / `format:check` package
scripts. That had two defects:

- **Only the npm scripts honoured it.** Any other entry point — the editor
  LSP (`oxfmt --lsp`), a bare `oxfmt .`, or a downstream repo that does not
  replicate the exact flag — silently ignored the file and could reformat or
  flag `dist`, `pnpm-lock.yaml`, `CHANGELOG.md` and `.standards/`.
- **The filename implied auto-discovery that does not exist**, so the
  indirection was easy to miss and easy to break.

Renaming to `.prettierignore` would make auto-discovery work, but it directly
contradicts change 0001, which removes Prettier and deletes `.prettierignore`
as part of the migration.

oxfmt's documented, recommended mechanism is `ignorePatterns` in the config
file: formatter-specific, uses `.gitignore` syntax, and applies globally —
CLI, LSP and bare invocations alike — without any flag. Because `.oxfmtrc.json`
is already a managed file, the patterns now propagate byte-exact to every repo.

## Mechanical steps (covered by `standards apply`)

- Rewrite the managed `.oxfmtrc.json` so `ignorePatterns` carries
  `dist`, `**/dist`, `coverage`, `pnpm-lock.yaml`, `CHANGELOG.md`,
  `.standards/`.

## Judgement steps (agent work, node scope)

`standards apply` writes managed files but never deletes files it no longer
manages, and it does not edit `package.json`. Spell these out per repo:

1. **Delete the obsolete `.oxfmtignore`.** Its patterns now live in
   `.oxfmtrc.json#ignorePatterns`. Remove any repo-specific extra patterns by
   carrying them over into `ignorePatterns` first, then delete the file.
2. **Drop the `--ignore-path` indirection from package scripts.** Change the
   `format` / `format:check` scripts to plain `oxfmt --write .` /
   `oxfmt --check .`. Remove any other `--ignore-path .oxfmtignore` usage.

## Notes

- `node_modules` and lock files such as `pnpm-lock.yaml` are ignored by oxfmt
  by default; keeping `pnpm-lock.yaml` in `ignorePatterns` is harmless and
  documents intent.
- Future formatter ignores belong in `ignorePatterns`, not in a separate
  ignore file.
