# Sebastian Software repository standards — agent instructions

You are updating a repository of the `sebastian-software` GitHub org to match
the org-wide standards defined in this package. Work changelog-driven, prefer
the CLI for mechanics, use judgement only where the changelogs require it.

## The model

- Every managed repository carries a `.repometa.json`:
  `{ "standards": <version>, "visibility": "oss" | "private", "since": <year>, "exceptions": [...], "workspaces": [...] }`
- `manifest.json` (in this package) defines the current standards version and,
  per scope, which files are **managed** (byte-exact sync), **seeded** (created
  once, repos may adapt them) and which README **sections** (marker-delimited
  blocks) are owned by the standards.
- `changes/NNNN-*.md` are migration changelogs. Each declares the scopes it
  applies to and describes intent, mechanical steps and judgement calls.
- Scopes are detected from the working tree: `common` always applies, `node`
  if `package.json` exists, `rust` if a root `Cargo.toml` exists. Detection also
  runs in every directory listed in `.repometa.json#workspaces`, where only the
  manifest entries marked `workspace` apply — per-package configuration, never
  the `common` scope, `renovate.json` or a CI workflow.

## Workflow

Human maintainers onboarding a brand-new repo (not handled by the agent
yet): see [`docs/runbooks/onboard-repo.md`](docs/runbooks/onboard-repo.md)
for the full step-by-step procedure.

1. Run `standards check`. If it reports nothing, you are done. Use the
   repository's own pinned CLI where there is one, so the run matches what its
   CI executes:

   ```sh
   pnpm exec standards check                                      # node scope
   pnpm --config.minimum-release-age=0 \
     dlx @sebastian-software/standards@<pinned version> check     # rust only
   ```

   The `--config.minimum-release-age=0` is mandatory on every `dlx` call of
   this package: pnpm 11 holds back versions younger than 24h, so without the
   bypass a version released today cannot resolve at all.

   Raise the pin and run `apply` in the same change. `check` compares
   `.repometa.json#standards` against the `manifest.json#currentVersion` of the
   CLI that runs it, and the two directions are different defects. Beside them
   it checks the shape of the pin itself:

   - **Repository behind the CLI** — ordinary drift. `standards apply` and the
     changelog entries repair it; `check` exits `1`.
   - **CLI behind the repository** — the run itself is invalid, because every
     other verdict was computed against an outdated manifest. `check` reports
     this as a **blocking** finding and exits `3`. It is not repaired by
     `apply`; the fix is to raise the `@sebastian-software/standards` pin to the
     release whose manifest carries the stamped version and refresh the
     lockfile. `apply` writes **nothing at all** in this direction — not the
     managed files, not the seeds, not the sections, and not the stamp — because
     a stale CLI carries the references of an earlier standards version and
     writing them would downgrade the repository's content while the stamp still
     claims the newer version. The evidence therefore survives untouched, except
     when `--from-version` was passed, which is the Renovate path where the
     stamp is legitimately raised ahead of the CLI that runs.

     `apply` and `sync` do not merely decline the work, they **report the same
     blocking finding and exit `3`** — a command that cannot validate a
     repository must not read as having completed it. `sync` stops before the
     agent: no prompt is built and no `claude` or `codex` process is started.
     `apply --from-version` is untouched by this and still exits `0`.

   - **The pin is not an exact version literal** — a `package.json` declares
     `@sebastian-software/standards` as a range (`^0.2.0`), a tag (`latest`), an
     `npm:` alias, a `catalog:`, `workspace:`, `file:` or `link:` reference, or a
     URL; or a repository whose CI workflow runs the standards CLI declares it in
     no examined `package.json` at all. `check` reports a blocking `pin` finding
     and exits `3`, because such a pin cannot be raised to the release a stamp
     needs. `package.json` is neither managed nor seeded, so `apply` does not
     repair it — but, unlike a stale CLI, a wrong pin shape does not make `apply`
     or `sync` refuse to write: a current CLI's references are still right. Set
     the specifier to an exact version in the `package.json` and dependency
     field that declares it; a `catalog:` entry moves out of the catalog into an
     exact `devDependencies` entry. Where no `package.json` declares the CLI, add
     an exact devDependency to the one the CI job installs from
     (`pnpm add --save-dev --save-exact @sebastian-software/standards@<version>`
     in that directory). The root and every directory in `.repometa.json#workspaces` are
     examined; the repository of the CLI itself is exempt. Rust-only `dlx` pins
     are not checked.

   The CLI-behind direction and a wrong pin shape are the two members of the
   **alignment class**. Exit code and write refusal are separate properties of
   it: both members exit `3`, only the stamp mismatch makes `apply` and `sync`
   refuse to write.

   Compatibility is never inferred from npm semver ordering. Prove it on two
   values: the installed `manifest.json#currentVersion` must equal
   `.repometa.json#standards`, and the pinned npm version must equal
   `.standards/pending.json#cliVersion` where a payload exists.

   `standards check --json` writes one object —
   `{ "findings": [{ "kind", "path", "detail", "blocking" }], "total", "blocking" }` —
   and no prose, for agents that need the classes rather than the text. Exit
   codes: `0` clean, `1` non-blocking findings only, `3` at least one blocking
   finding, `2` a usage error.

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
- **Repository-specific formatter ignores live in `.prettierignore`.**
  `.oxfmtrc.json` is managed byte-exact. Before `standards apply` restores it,
  it moves every `ignorePatterns` entry the managed file does not carry into
  the root `.prettierignore` — a workspace's entries rewritten relative to the
  root, because the seeded CI formats from there — and reports that file as
  `created` or `appended`. Keep those entries; do not move them back into
  `.oxfmtrc.json`. Only entries whose effect provably stays the same move:
  a config that contains any negation moves nothing, and a positive entry
  that could reach any directory with its own oxfmt config, declared as a
  workspace or not, stays too. Those are
  listed as comments under a "Not moved" header instead. Decide on each of
  them in the drift pull request — format the files, anchor the pattern, or
  drop it.
- **Seeded files are owned by the repo.** Do not overwrite local adaptations —
  merge the intent of the change into them instead.
- **Every content change to a seeded file requires a judgement step in
  the changelog that describes the merge strategy.** Without an explicit
  step, the change does not propagate to existing repos because
  `standards apply` never re-writes seeded files after first creation
  (see `src/apply.ts` `applySeeded`). Examples of what to spell out: new
  CI step to merge in, new ESLint rule, additional `cspell.json`
  dictionary entry, extra `oxlint.config.ts` override. State which lines come
  from the reference file and which repo-specific lines stay untouched.
- **Branding sections are owned by the standards.** Never hand-edit content
  between `<!-- sebastian-software-branding:start/end -->` markers; never
  remove the markers. `visibility: private` repos get the plain copyright
  footer, no marketing.
- **Respect `exceptions`.** Entries in `.repometa.json#exceptions` document
  deliberate deviations (e.g. `"keeps-prettier"`). Skip the matching steps and
  leave the exceptions in place.
- **Declare a workspace, do not guess one.** A `package.json` inside the
  repository is only managed when `.repometa.json#workspaces` lists its
  directory. A vendored mirror, a fixture, or a generated platform sidecar is
  not a workspace; adding one to the list is a judgement call, and removing a
  directory somebody declared is one too.
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
   through `.standards/pending.json`, raises the
   `@sebastian-software/standards` pin to that payload's `cliVersion` and
   refreshes the lockfile, runs the repo's gate in CI mode
   (`agent:check:ci`, else `agent:check`) and uses the output as fix
   hints, commits the judgement changes to the branch and **always
   pushes** regardless of the check outcome, writes or deletes
   `.standards/blocked.json` according to whether anything is still
   failing or incomplete, deletes the pending marker, removes
   the `standards:needs-agent` label, and sets `standards:needs-review`.
3. **Agent run 2 — semantic pre-check:** the same agent runs with a
   fresh context, reads the resulting diff plus the relevant SKILL/
   changelog material, and posts a PR comment summarizing changes,
   verifying SKILL.md rules, and recommending `merge` or `hold`.
4. **Human review:** maintainer reads the comment plus the diff and
   merges manually.

Until agent run 2 is wired, the maintainer reviews the diff manually
against the SKILL.md rules without an LLM pre-comment.

## The blocked marker

Pushing is not the same as having validated what was pushed. Run 1 always
pushes — that policy does not change — so the unvalidated case needs a trace a
machine can read. That trace is `.standards/blocked.json`.

Write it whenever **any** gate check is still failing or incomplete after the
best-effort fixes. Delete it when none is. It is never a run trigger: run 1 has
work only while `.standards/pending.json` is on the branch, so a marker left
behind fails the pull request and waits for a human or a new migration — it
cannot cause a retry loop.

```json
{
  "schemaVersion": 1,
  "blocking": true,
  "reason": "The pinned CLI ships manifest version 12, but .repometa.json is stamped 13.",
  "detectedAt": "2026-09-07T09:41:12.000Z",
  "expectedStandardsVersion": 13,
  "observedStandardsVersion": 13,
  "expectedCliVersion": "0.10.0",
  "observedCliVersion": "0.9.0",
  "failedChecks": ["standards check"],
  "retry": "Raise the @sebastian-software/standards devDependency to 0.10.0, refresh the lockfile, re-run the gate, then delete this file."
}
```

- `blocking` is `true` **only** for the alignment class, which has two members:
  the pinned CLI does not ship the manifest version the repository is stamped
  at, so no verdict of that run can be trusted; or the pin could not be made a
  bare exact version literal. Both make `standards check` exit `3`; only the
  stamp mismatch also makes `apply` and `sync` refuse to write. `reason` states
  which member blocked — for the pin-shape member it names the specifier class
  (a range, a `catalog:` reference, a URL) and never copies a URL specifier or
  its credentials, and `expectedCliVersion` and `observedCliVersion` may agree.
  The seeded CI guard hard-fails on it.
- Every other unfinished check sets `blocking: false` and lists the check in
  `failedChecks`. Those failures already fail the repository's own lanes; the
  marker records them as context for the reviewer rather than as a second
  failure source.
- `observedStandardsVersion`, `expectedCliVersion` and `observedCliVersion` are
  `null` where the value could not be read.
- `retry` states, in one sentence, what has to happen before the file is
  removed.
- The seeded CI guard **parses** the marker rather than matching lines, and
  fails closed on a file it cannot read: invalid JSON, or a marker that does not
  satisfy the schema above, fails the pull request exactly as `blocking: true`
  does. A guard whose purpose is to stop an unvalidated result must not be
  satisfied by a marker it did not understand.

The schema has one authoritative definition: `BlockedState` and
`assertBlockedState` in `src/blocked.ts` of this package.

`standards apply` neither writes nor deletes the marker — it only ever unlinks
the path it was given via `--emit-pending`. `.standards/` is excluded from
formatting and spell checking, so the file does not fight the gate it reports
on. Create the directory if the repository does not have one.

## Who owns which transition

The pull request state moves through steps that live in two different places.
This package owns the payload schema, the prompt text, this document, the
seeded CI guards, the migration entries and the semantics of `standards check`.
The external agent wiring owns everything that touches the forge.

| Transition                                | Owner                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Write `.standards/pending.json`           | this package (`standards apply --emit-pending`) |
| Read `.standards/pending.json`            | external wiring                                 |
| Commit and push the judgement result      | external wiring                                 |
| Post the run-1 information comment        | external wiring                                 |
| Post the run-2 summary comment            | external wiring                                 |
| Delete `.standards/pending.json`          | external wiring                                 |
| Write or delete `.standards/blocked.json` | external wiring (schema owned here)             |
| Add or remove `standards:needs-agent`     | external wiring                                 |
| Add or remove `standards:needs-review`    | external wiring                                 |
| Fail CI on a marker or on drift           | this package (seeded workflows)                 |
| Merge                                     | a human, always                                 |

Nothing in this package reads a payload or a marker back at runtime. Both
schemas are therefore contracts kept by coordination, not by a fail-closed
guard, which is why every change to them is listed below rather than assumed.

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

## Pull-mode agent wiring

The contract from `changes/0002-renovate-pending.md` makes
`.standards/pending.json` the only on-branch indicator for open
judgement steps. A drift PR whose branch still carries the marker sits
with red CI until an agent — or a maintainer — works it off.

> **Status:** agent run 1 is wired. An external agent picks up drift PRs
> through a webhook relay, with a scheduled daily scan as the safety net
> for a lost event. Agent run 2 has not been observed on a drift PR yet;
> until it is, the maintainer reviews without the LLM pre-comment (see
> "Merge policy"). A maintainer can always work the changelog steps
> locally as a fallback (`standards sync`).

The agent configuration itself lives outside this repo. This section
pins the contract that wiring has to keep.

### Two runs, one external wiring

The external agent infrastructure (webhook receiver or poller) handles
two routing paths, each a separate run with a fresh context — no memory
transfer between runs:

1. **Agent run 1 — mechanics.** Two questions are kept apart. **Whether
   run 1 has work** is decided by `.standards/pending.json` on the PR head
   and by nothing else: no marker, no work, whatever labels the pull
   request carries. **What starts the agent** may be the marker or the
   label `standards:needs-agent`; the label is a dispatch shortcut that
   saves looking the marker up, never a requirement. A wiring must also
   dispatch on the marker alone: run 1 removes the label when it finishes,
   so a wiring that requires the label never starts run 1 again for a
   branch Renovate recreates later (see "Recreated drift branches").
   Reads `pending.json` — its
   `prompt` field carries the instructions and references the `changes`
   array for the changelog bodies (which are not duplicated into the
   prompt).

   Its first step is the alignment pre-flight: raise the
   `@sebastian-software/standards` pin to `pending.json#cliVersion` (the
   npm version of the CLI that wrote the payload — under Renovate that is
   the freshly resolved `dlx` CLI, not the repository's possibly stale
   one), refresh the lockfile, and verify that the installed
   `manifest.json#currentVersion` equals `pending.json#toVersion` and that
   `.repometa.json#standards` does too after `apply`. Rust-only
   repositories raise the pinned `dlx` version in the CI workflow instead.

   It then performs the judgement steps, and runs the repo's own gate in CI mode
   — prefer `agent:check:ci`, fall back to `agent:check` — using the
   output as hints to improve the changes. The checks are **not** a merge
   gate: the agent does not abort on a failing check and always commits
   and pushes its best-effort result to the PR branch (never the default
   branch — see step 5 of the Workflow). It writes
   `.standards/blocked.json` when any check is still failing or
   incomplete and deletes it when none is (see "The blocked marker"). It
   then deletes `pending.json`, removes the `standards:needs-agent`
   label, and sets `standards:needs-review` (and/or writes
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

### Recreated drift branches

Renovate's rebase/retry checkbox does not rebase the commits on a drift
branch. Renovate regenerates the branch from its own update — one
`chore: standards v<N>` commit plus a fresh `standards apply` — and
force-pushes it. On a drift PR that already went through run 1 this
means:

- every judgement commit of run 1 is gone, and
  `.standards/pending.json` is back on the branch;
- the `standards:needs-agent` label is **not** restored — Renovate sets
  its labels when it opens a pull request, and run 1 removed this one;
- CI fails again for whatever run 1 had fixed.

Renovate says as much itself. After run 1 it posts an "Edited/Blocked"
notification: it no longer rebases the branch automatically, because it
does not recognize the last commit author, and it warns that ticking the
checkbox loses custom changes. `rebaseWhen` only governs these automatic
rebases, so no preset setting prevents the manual one.

Because the marker is back, a wiring that triggers on it starts run 1
again from scratch; the cost is a full agent run, not a stuck pull
request. Tick the checkbox on a drift PR only to deliberately restart
the migration — for instance after the default branch moved far enough
that run 1's result no longer applies — and expect run 1 to repeat.

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

Open items the external side has to adopt, from standards version 13:

1. **Read `pending.json#cliVersion`.** It is additive; `schemaVersion` stays
   `1`, so a payload written before version 13 simply does not carry the field
   and a reader must tolerate its absence rather than fail closed. When it is
   present, the pin is raised to exactly that value.
2. **Add `--config.minimum-release-age=0` to the Renovate `postUpgradeTasks`
   invocation.** The command is
   `pnpm dlx @sebastian-software/standards apply --from-version {{currentValue}} --emit-pending …`;
   without the bypass, pnpm 11 resolves a release up to 24 hours old and
   `cliVersion` silently records a lagging version, which defeats the whole
   mechanism. This is server configuration outside this repository.
3. **Write and delete `.standards/blocked.json`** per the schema above,
   including the `blocking` flag and the `retry` sentence.
4. **Keep the `--from-version` flag on every automated `apply`.** It is what
   tells the CLI that a stamp raised ahead of it is legitimate; without it the
   CLI applies nothing at all and exits `3`, so the migration pull request goes
   red with no payload and therefore no agent trigger.
5. **Treat `standards check` exit code `3` as unmergeable**, `1` as ordinary
   drift to be applied, and `2` as a usage error in the wiring itself.
