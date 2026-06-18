# Sebastian Software repository standards — agent instructions

You are updating a repository of the `sebastian-software` GitHub org to match
the org-wide standards defined in this package. Work changelog-driven, prefer
the CLI for mechanics, use judgement only where the changelogs require it.

## The model

- Every managed repository carries a `.repometa.json`:
  `{ "standards": <version>, "visibility": "oss" | "private", "since": <year>, "exceptions": [...] }`
- `manifest.json` (in this package) defines the current standards version and,
  per scope, which files are **managed** (byte-exact sync), **seeded** (created
  once, repos may adapt them) and which README **sections** (marker-delimited
  blocks) are owned by the standards.
- `changes/NNNN-*.md` are migration changelogs. Each declares the scopes it
  applies to and describes intent, mechanical steps and judgement calls.
- Scopes are detected from the working tree: `common` always applies, `node`
  if `package.json` exists, `rust` if `Cargo.toml` exists (not yet defined).

## Workflow

1. Run `pnpm dlx @sebastian-software/standards check`. If it reports
   nothing, you are done.
2. Run `standards apply`. It writes managed files, seeds missing ones, updates
   branding sections and bumps the stamp. This covers the mechanical part only.
3. Read every entry in `changes/` with a number greater than the repo's
   previous `standards` stamp, skipping entries whose scope does not apply.
   Carry out their migration steps — this is the part that needs judgement
   (merging configs the repo has customised, removing replaced tooling,
   adjusting package.json scripts).
4. Verify with the repo's own gate: `pnpm agent:check` if present, otherwise
   lint + format check + typecheck + build + test individually.
5. Open a PR titled `chore: standards v<N>`. Never push to the default branch.

## Rules

- **Never reintroduce Prettier.** oxfmt is the org formatter. If a repo still
  uses Prettier, migrating away from it is part of the job (see change 0001).
- **Seeded files are owned by the repo.** Do not overwrite local adaptations —
  merge the intent of the change into them instead.
- **Branding sections are owned by the standards.** Never hand-edit content
  between `<!-- sebastian-software-branding:start/end -->` markers; never
  remove the markers. `visibility: private` repos get the plain copyright
  footer, no marketing.
- **Respect `exceptions`.** Entries in `.repometa.json#exceptions` document
  deliberate deviations (e.g. `"keeps-prettier"`). Skip the matching steps and
  leave the exceptions in place.
- **Do not invent standards.** If something is unclear or a reference file is
  missing for the repo's stack, stop and report instead of improvising.

## Renovate onboarding

When Renovate opens its first onboarding PR (`Configure Renovate`) on a
new consumer repo, it may write `local>sebastian-software/renovate-config`
for the preset reference. The canonical form is `github>...` — on
Forgejo workers, `local>` resolves Forgejo-resident while `github>`
resolves GitHub-resident, and the preset repo lives on GitHub.

Before merging the onboarding PR, edit the file so both preset entries
use the `github>` prefix:

```json
{
  "extends": [
    "github>sebastian-software/renovate-config",
    "github>sebastian-software/renovate-config:standards"
  ]
}
```

The seeded `renovate.json` in this package already uses the canonical
form, so once a repo is past onboarding, `standards apply` keeps it
correct.
