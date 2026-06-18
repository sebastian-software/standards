# 0003 — Platform-aware manifest and GitHub Actions CI seed

- **Scopes:** common, node
- **Standards version:** 3

## Intent

Establishes a `platform` field on `.repometa.json` (`"github" | "forgejo"`)
and an optional `platform` field per manifest entry, so the CI
infrastructure ships platform-aware from the start. As the first
application, the GitHub Actions CI workflow ships as a seeded file on
repos with `platform: "github"`. Forgejo follows in a later changelog
(see issue #10).

## Mechanical steps (covered by `standards apply`)

- Existing managed and seeded entries without `platform` continue to
  apply to every repo regardless of the `platform` stamp.
- The new seeded entry `reference/node/github-workflows-ci.yml` →
  `.github/workflows/ci.yml` carries `platform: "github"` and lands
  only on GitHub repos. On Forgejo or legacy (no `platform`) repos,
  `standards apply` skips the entry — no write, no drift finding from
  `standards check`.

## Judgement steps (agent work)

1. **Set the repo platform (legacy migration).** If `.repometa.json`
   has no `platform` field, run
   `standards init --force --platform <p>` with `<p>` equal to
   `github` or `forgejo` depending on where the repo lives, then re-run
   `standards apply`. This step is a one-shot migration; new repos
   created via `standards init` write `platform` from the start.
2. **GitHub repos (`platform: "github"`): merge the seeded CI
   workflow with any existing one.** `standards apply` seeds
   `.github/workflows/ci.yml` only when the file does not exist. If a
   repo already has a CI workflow, merge the reference content with
   the repo-specific steps (the seeded-files update rule from `#16`
   applies): take the pending guard, the `pnpm run --if-present` chain
   and the `pnpm dlx @sebastian-software/standards check` step from
   the reference; preserve repo-specific extras (custom matrix,
   deploy step, etc.) untouched.
3. **Forgejo repos (`platform: "forgejo"`): no CI seed in this
   version.** A separate changelog will add a Forgejo CI workflow
   under `.forgejo/workflows/ci.yml` (issue #10). Until then, Forgejo
   repos keep their existing CI configuration unchanged.

## Notes

- The `platform` field becomes part of the `.repometa.json` schema
  going forward. `standards init` prompts for it (default derived
  from `git remote get-url origin`: `github.com` → `github`,
  everything else → `forgejo`), and accepts the `--platform` flag for
  non-interactive use.
- Filter contract: an entry without `platform` applies everywhere; an
  entry with `platform` applies only on a repo whose
  `.repometa.json#platform` matches. Legacy repos without `platform`
  receive no platform-scoped entries — the migration step above
  closes the gap.
- The seeded CI workflow's `pnpm/action-setup` version stays at
  whatever major is current at apply time (Renovate keeps it up to
  date once the file is in place).
- The matching `.repometa.json` stamp in the fixture repo
  `standards-test-repo2` is tracked separately as
  `sebastian-software/standards-test-repo2#4`.
