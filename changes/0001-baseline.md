# 0001 — Baseline: oxfmt, oxlint + eslint-config-setup, branding, repometa

- **Scopes:** common, node
- **Standards version:** 1

## Intent

Establish the org baseline: oxfmt replaces Prettier as the only formatter,
linting is OxLint first plus type-aware ESLint via `eslint-config-setup`,
every repo carries a `.repometa.json` stamp and a managed branding footer.

## Mechanical steps (covered by `standards apply`)

- Create `.repometa.json` if missing (apply requires it — create it by hand
  with the repo's first release year as `since` before running apply).
- Write managed files: `.oxfmtrc.json`, `.oxfmtignore`.
- Seed if missing: `eslint.config.ts`, `oxlint.config.ts`, `tsconfig.json`,
  `cspell.json`, `renovate.json`.
- Upsert the `sebastian-software-branding` README section.

## Judgement steps (agent work, node scope)

1. **Remove Prettier completely:** uninstall `prettier`, `@effective/prettier`
   and all `prettier-plugin-*` devDependencies; delete `.prettierrc*`,
   `.prettierignore`, `prettier` keys in package.json; replace any
   `lint-staged`/husky formatting hooks with oxfmt equivalents or drop them.
2. **Install the toolchain:** `eslint`, `eslint-config-setup`, `oxlint`,
   `oxfmt`, `jiti`, `typescript` as devDependencies (current majors).
3. **Converge package.json scripts** on the org shape:
   `lint`, `lint:eslint`, `lint:oxlint`, `format`, `format:check`, `typecheck`,
   `build`, `test`, `agent:check` — see `reference/node/` and the org template
   `sebastian-software/template-oss` for the exact shape. Keep repo-specific
   extra scripts.
4. **Migrate custom lint rules:** if the repo had a hand-written ESLint config,
   re-express deliberate overrides on top of
   `getEslintConfig({ node/react, oxlint: true })` instead of keeping the old
   config. React repos use `react: true`.
5. **Reformat the tree** with `pnpm format` as a separate commit.
6. If the repo publishes to npm, make sure `files`/`exports` are unaffected by
   the new config files.

## Notes

- `visibility: "oss"` repos get the marketing footer (consulting line +
  open-source link); `private` repos get the plain copyright line.
- Rust-only repositories: only the branding section and `.repometa.json`
  apply; the rust scope is defined in a later change.
