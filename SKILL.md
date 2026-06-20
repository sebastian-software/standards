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

Human maintainers onboarding a brand-new repo (not handled by the agent
yet): see [`docs/runbooks/onboard-repo.md`](docs/runbooks/onboard-repo.md)
for the full step-by-step procedure.

1. Run `pnpm --config.minimum-release-age=0 dlx @sebastian-software/standards check`.
   If it reports nothing, you are done. The `--config.minimum-release-age=0` is
   mandatory on every `pnpm dlx @sebastian-software/standards …` call: pnpm 11
   holds back versions younger than 24h, but the stamp is written by `apply`
   against the true latest, so without the bypass `check` resolves a stale CLI
   and reports false drift right after a standards release.
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
- **Every content change to a seeded file requires a judgement step in
  the changelog that describes the merge strategy.** Without an explicit
  step, the change does not propagate to existing repos because
  `standards apply` never re-writes seeded files after first creation
  (see `src/apply.ts` `applySeeded`). Examples of what to spell out: new
  CI step to merge in, new ESLint rule, additional `cspell.json`
  dictionary entry, extra `.oxfmtignore` pattern. State which lines come
  from the reference file and which repo-specific lines stay untouched.
- **Branding sections are owned by the standards.** Never hand-edit content
  between `<!-- sebastian-software-branding:start/end -->` markers; never
  remove the markers. `visibility: private` repos get the plain copyright
  footer, no marketing.
- **Respect `exceptions`.** Entries in `.repometa.json#exceptions` document
  deliberate deviations (e.g. `"keeps-prettier"`). Skip the matching steps and
  leave the exceptions in place.
- **Respect `platform`.** Manifest entries without `platform` apply to every
  repo. Entries with `platform` apply only on a repo whose
  `.repometa.json#platform` matches. Legacy repos without `platform` skip
  every platform-scoped entry until the migration step from change 0003 is
  carried out (`standards init --force --platform <p>`, then re-run apply).
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

## Merge policy

The final merge of a `standards:` PR is **always a human step**. Automerge
is explicitly disabled for this PR class.

Reason: every standards update can implicitly shift tool behavior broadly
(linter, formatter, CI rules); a human eye at the end is the cheapest
insurance against hallucinations or training-data drift in the agent or
review LLM. The `standards` package rule in the org Renovate preset stays
without `automerge: true` for exactly this reason; do not add it "for
consistency".

Pipeline order for a `standards:` PR:

1. Renovate opens the bump PR.
2. **Agent run 1 — mechanics:** the external pull-mode agent works
   through `.standards/pending.json`, runs the repo's gate in CI mode
   (`agent:check:ci`, else `agent:check`) and uses the output as fix
   hints, commits the judgement changes to the branch and **always
   pushes** regardless of the check outcome, deletes the marker, removes
   the `standards:needs-agent` label, and sets `standards:needs-review`.
3. **Agent run 2 — semantic pre-check:** the same agent runs with a
   fresh context, reads the resulting diff plus the relevant SKILL/
   changelog material, and posts a PR comment summarizing changes,
   verifying SKILL.md rules, and recommending `merge` or `hold`.
4. **Human review:** maintainer reads the comment plus the diff and
   merges manually.

Until agent run 2 is wired, the maintainer reviews the diff manually
against the SKILL.md rules without an LLM pre-comment.

## Branch protection setup

Without branch protection on `main`, the consumer-repo CI guard is soft:
a maintainer (or a misclick) could merge a red state, and the
`pending.json` guard loses its effect. The merge policy above presupposes
hard required status checks; otherwise the whole CI gate architecture is
decorative.

### GitHub

Required settings on `main` for every consumer repo:

- `main` is a protected branch.
- "Require status checks to pass before merging" enabled, with the
  CI workflow name (e.g. `ci`) listed as a required check.
- "Require branches to be up to date before merging" enabled.
- Optional but recommended: "Require linear history", "Allow force
  pushes: none", "Allow deletions: none".

Idempotent one-shot via `gh`:

```bash
gh api repos/$ORG/$REPO/branches/main/protection -X PUT \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]=ci \
  -F enforce_admins=true \
  -F required_pull_request_reviews= \
  -F restrictions=
```

### Forgejo

Forgejo's branch-rules API differs (`POST /repos/{owner}/{repo}/branch_protections`)
but the required setting set is equivalent: protect `main`, require the
named CI check to pass, require branches up to date, disallow force pushes
and deletions. Verification on Forgejo is deferred until the first Forgejo
consumer repo opts in; once it does, mirror the GitHub setup above and
record the exact API payload here.

## Pull-mode agent wiring (open)

The contract from `changes/0002-renovate-pending.md` makes
`.standards/pending.json` the only on-branch indicator for open
judgement steps. As long as no external agent listens for the marker
(or the `standards:needs-agent` label), every drift PR sits with red CI
and the cycle stays formally open.

> **Status:** as long as the agent is not wired, the final merge — until
> `.standards/pending.json` is gone — is **manual**. A maintainer can
> always work the changelog steps locally as a fallback (`standards sync`).

The agent configuration itself lives outside this repo. This section
keeps the gap visible and pins the contract so the wiring effort
(OpenClaw / Claude Code / Codex installation) has a stable target.

### Two runs, one external wiring

The external agent infrastructure (webhook receiver or poller) handles
two routing paths, each a separate run with a fresh context — no memory
transfer between runs:

1. **Agent run 1 — mechanics.** Triggered by label
   `standards:needs-agent` or by the presence of
   `.standards/pending.json` in the PR diff. Reads `pending.json` — its
   `prompt` field carries the instructions and references the `changes`
   array for the changelog bodies (which are not duplicated into the
   prompt). Performs the judgement steps, and runs the repo's own gate in CI mode
   — prefer `agent:check:ci`, fall back to `agent:check` — using the
   output as hints to improve the changes. The checks are **not** a merge
   gate: the agent does not abort on a failing check and always commits
   and pushes its best-effort result to the PR branch (never the default
   branch — see step 5 of the Workflow). It then deletes
   `pending.json`, removes the `standards:needs-agent` label, and sets
   `standards:needs-review` (and/or writes
   `.standards/review-pending.json`) as the last step.

   The pull request's own full CI run plus human review are the actual
   gate; the maintainer reviews and merges. Providing CI-appropriate
   environment variables — so deploy/connection checks do not fail for
   lack of a local dev environment — is the external wiring's
   responsibility. See
   [#37](https://github.com/sebastian-software/standards/issues/37).

   When the agent's own gate run produced any failed or incomplete checks,
   it posts **one separate information comment** on the PR listing each such
   check with its output and noting that the automated environment may lack
   prerequisites (e.g. environment variables), so its results can differ
   from the PR's own CI run and a human should verify. This comment is
   posted only when there are failures, in addition to run 2's summary
   comment, and does not change the always-finalize behavior; the failures
   stay recorded. See
   [#40](https://github.com/sebastian-software/standards/issues/40).

2. **Agent run 2 — semantic pre-check.** Triggered by label
   `standards:needs-review` or by `.standards/review-pending.json`. Reads
   the PR diff, the relevant changelog entries, `SKILL.md`, and
   `.repometa.json` (including `exceptions`) — nothing else. Posts a PR
   comment per the output contract below. Removes the
   `standards:needs-review` label and the marker file at the end.

On Forgejo, label setting is unreliable; the marker file
(`.standards/pending.json` for run 1, `.standards/review-pending.json`
for run 2) is the **primary** signal. The labels are an optimization
for GitHub.

### Agent run 2 — output contract

Run 2 posts exactly one PR comment with four sections, in order:

- **(a) Summary of agent changes.** Which files were modified, mapped
  to the judgement steps from which changelog.
- **(b) SKILL.md consistency check.** Tabular pass/fail per rule
  (Prettier reintroduction, branding markers intact, `exceptions`
  respected, seeded-vs-managed contract upheld).
- **(c) Judgement step verdicts.** Each step from each changelog with
  one of `ok` / `check` (the latter for steps the agent could not
  definitively verify).
- **(d) Recommendation.** Exactly one of `merge` or `hold`, with a
  one-sentence reason.

The prompt template for run 2 is checked in at
`reference/agent/review-prompt.md` so the external wiring uses a
versioned template (analog to how `SKILL.md` anchors the run-1 prompt
indirectly via the `buildPrompt` output).

### Fallback

If run 2 fails (agent system down, label stuck, marker file deleted by
a rebase), the maintainer does the review manually against the SKILL.md
rules and merges without the LLM pre-comment. The merge policy stays
the same: humans always merge.

### External wiring follow-up

The external wiring (webhook receiver, prompt routing, secrets) is
tracked outside this repo. One follow-up ticket covers both runs — they
share the same infrastructure, only the trigger path and prompt mode
differ. Link to the external ticket goes here once it exists.
