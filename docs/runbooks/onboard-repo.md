# Onboarding a new repo to the standards system

This runbook walks a maintainer through bringing a repo under the
`@sebastian-software/standards` system. It exists so that no step
gets skipped on the way from "empty repo" to "Renovate keeps it
current, agent does the judgement work, a human merges". The
agent-driven half is partially manual today (see
[#13](https://github.com/sebastian-software/standards/issues/13))
— the runbook calls that out where it matters.

Two variants are covered:

- **Variant A — New repo.** A fresh GitHub or Forgejo repo with no
  history under the standards. This is the default.
- **Variant B — Legacy repo onboarding.** An existing repo with a
  custom toolchain that needs to converge to the standards (Prettier
  → oxfmt, custom CI → seeded CI, etc.). Walks Variant A plus the
  manual judgement work from [`changes/0001-baseline.md`](../../changes/0001-baseline.md).

## Cross-references

- [SKILL.md](../../SKILL.md) — agent contract, pull-mode wiring,
  branch protection, merge policy. The single source of truth for
  what the agent does.
- [README.md](../../README.md) — three-repo overview, Renovate
  model, file ownership table.
- [`CLAUDE.md`](../../CLAUDE.md) — local Claude Code instructions
  (if present in your dev environment).
- Changelogs:
  [`0001-baseline.md`](../../changes/0001-baseline.md),
  [`0002-renovate-pending.md`](../../changes/0002-renovate-pending.md),
  [`0003-platform-aware-ci.md`](../../changes/0003-platform-aware-ci.md),
  [`0004-ci-workflow-forgejo.md`](../../changes/0004-ci-workflow-forgejo.md).
- Branch-protection snippet:
  [SKILL.md#branch-protection-setup](../../SKILL.md#branch-protection-setup).
- Open agent gap:
  [SKILL.md#pull-mode-agent-wiring-open](../../SKILL.md#pull-mode-agent-wiring-open).

## Variant A — New repo

The following steps assume you have shell access, `gh` (for GitHub)
or `forgejo` CLI / curl (for Forgejo), and `pnpm`.

### 1. Create the repo

GitHub:

```bash
gh repo create sebastian-software/<name> --public --default-branch main
```

Forgejo (via API or web UI):

```bash
curl -X POST "https://<forgejo-host>/api/v1/orgs/sebastian-software/repos" \
  -H "Authorization: token $FORGEJO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "<name>", "default_branch": "main", "private": false}'
```

In both cases the default branch must be `main`. The merge policy and
the seeded CI workflows assume this.

### 2. Set the `managed-deps` topic

The self-hosted Renovate worker discovers repos via
`autodiscoverTopics: ["managed-deps"]`. Without the topic, Renovate
ignores the repo and step 5 onward does nothing.

GitHub:

```bash
gh api repos/sebastian-software/<name>/topics \
  -X PUT \
  -f names[]=managed-deps
```

Forgejo:

```bash
curl -X PUT "https://<forgejo-host>/api/v1/repos/sebastian-software/<name>/topics" \
  -H "Authorization: token $FORGEJO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topics": ["managed-deps"]}'
```

### 3. (Node repos only) `pnpm init`

If the repo is a Node.js project but does not yet have a
`package.json`, create one. Without `package.json`, the `node` scope
in the manifest does not detect (see `manifest.json#scopes.node.detect`)
and none of the Node-side seeded files land.

```bash
cd <repo-clone>
pnpm init
```

Rust-only or documentation-only repos skip this step.

### 4. Initialise `.repometa.json`

```bash
pnpm dlx @sebastian-software/standards init \
  --platform <github|forgejo> \
  --visibility <oss|private> \
  --since <year>
```

All flags are optional. Without `--yes`, missing values are prompted
interactively:

- `--platform` — `github` or `forgejo`. The interactive prompt
  default is derived from `git remote get-url origin`
  (`github.com` → `github`, everything else → `forgejo`). The
  platform stamp routes platform-scoped manifest entries (e.g. the
  CI seeds).
- `--visibility` — `oss` (default) or `private`. Selects the README
  branding footer.
- `--since` — initial copyright year. Defaults to the year of the
  repository's first git commit; falls back to the current year if
  there is no history yet.
- `--yes` — non-interactive mode; fails fast if a required value is
  neither flagged nor defaultable.
- `--force` — overwrite an existing `.repometa.json` (e.g. when
  adding `platform` to a legacy stamp).

The stamp lands at `.repometa.json#standards = 0`. The first
`standards apply` (typically the Renovate drift PR in step 7) bumps
it to the current `manifest.json#currentVersion`.

### 5. Merge the Renovate onboarding PR

Once the topic is set, the next Renovate worker run opens an
onboarding PR titled `Configure Renovate`. Wait time depends on your
worker cadence (self-hosted Renovate typically every 15 min on the
default schedule).

Before merging, edit the file if Renovate wrote
`local>sebastian-software/renovate-config` — the canonical form is
`github>` on both platforms (the preset repo lives on GitHub). See
[SKILL.md#renovate-onboarding](../../SKILL.md#renovate-onboarding) for
the exact JSON shape.

Merge the onboarding PR via the platform UI or `gh pr merge`.

### 6. Set branch protection

Without hard required status checks on `main`, the CI guard from the
seeded `ci.yml` is soft — a maintainer (or misclick) could merge a
red state, and the `.standards/pending.json` guard would lose its
teeth. The whole merge policy in
[SKILL.md#merge-policy](../../SKILL.md#merge-policy) presupposes
hard required status checks.

GitHub (idempotent one-shot via `gh`):

```bash
gh api repos/sebastian-software/<name>/branches/main/protection -X PUT \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]=ci \
  -F enforce_admins=true \
  -F required_pull_request_reviews= \
  -F restrictions=
```

Forgejo: the API is `POST /repos/{owner}/{repo}/branch_protections`
with an equivalent payload. Verification on Forgejo is deferred
until the first Forgejo consumer repo opts in; once it does, mirror
the GitHub setup above and record the exact payload in SKILL.md.
See
[SKILL.md#branch-protection-setup](../../SKILL.md#branch-protection-setup).

A companion `scripts/onboard-repo.sh` (or an Ansible task in the
proxmox repo) that wraps steps 2 + 6 in one shot is a follow-up
improvement, tracked in this runbook's surrounding plan
[`docs/plan/0011-onboarding-runbook.md`](../plan/0011-onboarding-runbook.md).

### 7. Await the first drift PR (and the open agent gap)

Once the topic is set, the standards stamp is initialised, and the
Renovate preset is active, the next worker run opens a drift PR
titled `chore(standards): v<N>`. It contains:

- The `.repometa.json` stamp bump from `0` to the current
  `manifest.json#currentVersion`.
- All mechanical file writes from `standards apply` (managed +
  seeded + branding section).
- `.standards/pending.json` describing the judgement steps for the
  changelogs that need work (skipped if none).
- Label `standards:needs-agent` (GitHub) and/or the presence of
  `pending.json` (Forgejo).

**Open agent gap.** The external pull-mode agent that picks up
`pending.json` is **not** wired in this org yet — see
[SKILL.md#pull-mode-agent-wiring-open](../../SKILL.md#pull-mode-agent-wiring-open)
and [#13](https://github.com/sebastian-software/standards/issues/13).
Until that wiring lands:

- Check out the drift PR branch locally.
- Read `.standards/pending.json` (it carries the same prompt that
  `standards sync --dry-run` would print).
- Walk the judgement steps yourself or run `standards sync` locally
  (`claude` or `codex`).
- Commit the judgement changes to the PR branch and delete
  `.standards/pending.json`.

Once `pending.json` is gone, the CI guard step from the seeded
`ci.yml` (`test ! -f .standards/pending.json`) turns green.

### 8. Review the pre-review LLM comment and merge

The second agent run (see
[SKILL.md#two-runs-one-external-wiring](../../SKILL.md#two-runs-one-external-wiring))
posts a PR comment summarising the changes, checking SKILL.md
rules, and recommending `merge` or `hold`. Today this is the
_intended_ state — until the external wiring lands, the maintainer
reads the diff and SKILL.md rules manually without an LLM
pre-comment, and merges via Variant A from
[`changes/0001`](../../changes/0001-baseline.md) and the merge
policy in [SKILL.md#merge-policy](../../SKILL.md#merge-policy).

The final merge is **always a human step**. Automerge is
deliberately disabled for `standards:` PRs.

## Variant B — Legacy repo onboarding

Onboarding an existing repo with a custom toolchain follows the same
eight steps as Variant A, with these adjustments:

- **Step 4 — `.repometa.json` initialisation.** Pick the `since`
  year to reflect the original creation year of the repo, not the
  year of the standards adoption. The branding footer's copyright
  range uses this value.
- **Step 7 — first drift PR is large.** The first
  `standards apply` against a legacy repo seeds _every_ applicable
  file at once, plus the
  [`changes/0001-baseline.md`](../../changes/0001-baseline.md)
  judgement steps fire: Prettier removal, oxfmt/oxlint adoption,
  `package.json` scripts convergence to the standards shape, ESLint
  config migration. Plan for a manually-walked review session
  before merging. The pending payload in `.standards/pending.json`
  carries every changelog step from `0001` upward; do not skip any
  step that does not have an explicit exception in
  `.repometa.json#exceptions`.
- **Step 7 — exceptions.** If a legacy repo deliberately keeps a
  non-standard piece (e.g. Prettier because the team has external
  authoring tooling), document the exception in
  `.repometa.json#exceptions` (e.g. `"keeps-prettier"`) before
  walking the judgement steps. The agent (and the human reviewer)
  skips the matching steps.
- **Step 8 — manual diff review is mandatory.** Until the external
  pre-review agent is wired, the maintainer manually checks each
  changelog's judgement step against the SKILL.md rules. For a
  large legacy migration this is an hour of careful reading, not a
  rubber-stamp.

Beyond these adjustments, Variant B is identical to Variant A.

## After onboarding

The repo is now in the standards rotation:

- Future Renovate worker runs detect drift the moment the package's
  `manifest.json#currentVersion` advances, and open a new
  `chore(standards): v<N>` PR.
- CI keeps the repo honest via the seeded `ci.yml` workflow.
- Branch protection keeps the merge gate honest.
- The agent (once wired) keeps the judgement loop honest.
- The human merge stays the final word.

## Troubleshooting

- **No Renovate PR after step 2.** Verify the topic is exactly
  `managed-deps` (not `managed_deps`, `standards-managed`, etc.) and
  that the Renovate worker has read access to the repo. Self-hosted
  Renovate worker logs show whether autodiscovery picked up the
  topic.
- **`standards apply` writes nothing.** Check `.repometa.json`
  exists and parses, and that the relevant scope detects (`node`
  needs `package.json`, `rust` needs `Cargo.toml`). For
  platform-scoped entries, also check `platform` is set; see
  [`changes/0003-platform-aware-ci.md`](../../changes/0003-platform-aware-ci.md).
- **`standards check` reports `platform is missing`.** Legacy stamp
  without `platform`. Run
  `pnpm dlx @sebastian-software/standards init --force --platform <p>`
  to migrate, then re-run `apply`.
- **CI is red on the drift PR because of `.standards/pending.json`.**
  Expected. The CI guard step refuses to pass until the agent (or a
  human stand-in) completes the judgement work and removes the
  marker file.
