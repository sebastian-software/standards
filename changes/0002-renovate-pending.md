# 0002 — Renovate as the single driver for standards updates

- **Scopes:** common
- **Standards version:** 2

## Intent

From this version on, standards updates across all managed repos are
initiated uniformly by the self-hosted Renovate server. Renovate handles
both version detection (bump of `.repometa.json#standards`) and the
mechanical sync (`standards apply`). The judgement part is performed by
an externally triggered LLM agent (OpenClaw, local Claude Code, or
Codex) in pull mode. The agent deliberately does not run inside the
Renovate container.

## Mechanical steps (covered by `standards apply`)

- No file changes in target repos beyond what previous changelogs already
  required. The `.standards/pending.json` marker is written by Renovate's
  `postUpgradeTasks` step when `standards apply --emit-pending` is invoked
  with a non-zero set of pending judgement entries.

## Judgement steps (agent work)

- None at consumer level. This change is structural — it changes how
  future versions of `@sebastian-software/standards` are rolled out across
  the org, not what consumer repos contain.

## Notes

- **Per-repo bootstrap (manual, one-off):** the repo carries the existing
  `managed-deps` topic of the Renovate server. `.repometa.json` is
  created by running `pnpm dlx @sebastian-software/standards init`
  (interactive prompts for visibility and initial year; flags are
  available for CI). The onboarding PR (`Configure Renovate`) has to
  be merged once before standards drift becomes visible in the UI.
- **Renovate server prerequisite:** a custom datasource reads
  `manifest.json#currentVersion` as an integer directly from the
  standards repo instead of using the published package's npm semver.
  This keeps the version model stack-agnostic (Rust, doc-only, or mixed
  repos never see a semver) and the PR title follows the
  `chore: standards v<N>` convention from `SKILL.md`.
- **Self-hosted Renovate is mandatory.** Mend Cloud (the GitHub App)
  does not support `postUpgradeTasks`. `allowedCommands` must permit
  the exact `apply` invocation; `executionMode: "branch"` avoids known
  problems with `executionMode: "update"`.
- **Pull model:** Renovate opens the PR and writes
  `.standards/pending.json` when judgement steps exist. An external
  agent consumes the file, commits the judgement changes onto the same
  branch, and removes any `standards:needs-agent` label that was set.
  On Forgejo, label setting is less reliable than on GitHub — pull
  consumers should filter primarily on the presence of the file, not
  exclusively on the label.
- **`apply` write contract:** `standards apply` writes only to
  (a) managed/seeded targets declared in `manifest.json`,
  (b) branding sections declared in `manifest.json`,
  (c) `.repometa.json#standards`, and (d) the path passed via
  `--emit-pending`. This makes broad `fileFilters: ["**/*"]` safe on the
  server side.
- **Consumer tools outside the standards scopes** (Prettier leftovers
  during migration, Biome, gitleaks, dependabot configs,
  semantic-release pipelines, custom lint scripts) must ignore
  `.standards/` themselves when they would otherwise scan every repo
  path. The standards-scope ignore files (`oxfmtignore`, `cspell.json`)
  are maintained by the standards package; foreign tools are out of
  scope.
