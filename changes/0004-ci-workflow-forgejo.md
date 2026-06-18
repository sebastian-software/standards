# 0004 — Forgejo Actions CI seed

- **Scopes:** node
- **Standards version:** 4

## Intent

Extends the platform-aware CI infrastructure from change 0003 with a
Forgejo Actions variant. A second reference file
(`reference/node/forgejo-workflows-ci.yml`) ships the same pipeline
shape as the GitHub Actions seed, but targets the Forgejo runner
(`runs-on: docker`, explicit container image) and lands under
`.forgejo/workflows/ci.yml`.

This is purely additive on the GitHub side: GitHub repos see no new
seed entries. Forgejo repos at `platform: "forgejo"` get the new file
the next time `standards apply` runs.

## Mechanical steps (covered by `standards apply`)

- The new seeded entry `reference/node/forgejo-workflows-ci.yml` →
  `.forgejo/workflows/ci.yml` carries `platform: "forgejo"` and lands
  only on Forgejo repos. On GitHub or legacy (no `platform`) repos,
  `standards apply` skips the entry — no write, no drift finding.

## Judgement steps (agent work)

1. **GitHub repos (`platform: "github"`): no action.** This change is
   not visible. The `standards apply` stamp moves to 4 without any
   file write beyond the stamp itself.
2. **Forgejo repos (`platform: "forgejo"`): merge the seeded CI
   workflow with any existing one.** `standards apply` seeds
   `.forgejo/workflows/ci.yml` only when the file does not exist. If
   a Forgejo repo already has a CI workflow under
   `.forgejo/workflows/`, merge the reference content with the
   repo-specific steps (the seeded-files update rule from issue #16
   applies): take the pending guard, the `pnpm run --if-present`
   chain, and the `pnpm dlx @sebastian-software/standards check`
   step from the reference; preserve repo-specific extras (custom
   matrix, deploy step, etc.) untouched.
3. **Legacy repos (no `platform`): set the platform first.** The
   migration step from change 0003 still applies. Until
   `.repometa.json#platform` is set, the standards stamp does not
   bump (the legacy gate from change 0003 blocks it). Run
   `standards init --force --platform <github|forgejo>` first, then
   re-run `standards apply`.

## Notes

- Forgejo Actions discovers workflows in `.forgejo/workflows/` first
  and falls back to `.github/workflows/` if the Forgejo path does
  not exist. Repos that already mirror a GitHub workflow into
  `.github/workflows/` keep working — the seed adds a Forgejo-native
  workflow that takes precedence once present.
- `runs-on: docker` plus an explicit
  `container: code.forgejo.org/oci/node:24-bookworm` keeps the seed
  reproducible across Forgejo runner pools without depending on
  registered `ubuntu-latest` labels. The pipeline shape mirrors the
  GitHub seed (pnpm + Node 24, `pnpm run --if-present` chain, drift
  check).
- The matching `.repometa.json` stamp in the fixture repo
  `standards-test-repo2` is tracked separately as
  `sebastian-software/standards-test-repo2#5`.
