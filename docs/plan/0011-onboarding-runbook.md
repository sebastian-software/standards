# 0011: Onboarding runbook for new consumer repos

**Plan status:** Implemented
**Source:** /build
**Recommended workflow:** Documentation (`/docs`)
**Doku-Kategorie:** runbooks
**Ziel-Pfad:** docs/runbooks/onboard-repo.md

## Requirement

Bootstrapping a new consumer repo today is a scattered procedure:
`.repometa.json`, topic, Renovate onboarding, branch protection,
agent wiring, manual review — all documented across SKILL.md,
README.md, four changelog files, and the (still open) external agent
ticket. A single runbook reduces the risk of skipping a step (e.g.
topic set but branch protection forgotten) and makes the open agent
gap from `#13` stay visible in one place.

This is a pure documentation change. No source files change.

## Architecture decisions

- **Place the runbook in `docs/runbooks/onboard-repo.md`.** The SF
  doc convention reserves `docs/runbooks/` for step-by-step
  procedures. The runbook is exactly that. Top-level `RUNBOOK.md` was
  considered but rejected: it would compete with `SKILL.md` and
  `README.md` for top-level attention and break the docs hierarchy.
- **Two variants, side by side.** The issue calls out Variant A (new
  repo) and Variant B (legacy onboarding). They share most steps;
  Variant B adds the manual changes/0001 walk-through. Keeping them
  in one file with a clearly delimited "Legacy onboarding addendum"
  section keeps the diff cost of future updates low.
- **No new scripts in this PR.** The issue mentions an optional
  `scripts/onboard-repo.sh` as a follow-up improvement. The runbook
  flags the gap and points at the manual `gh api` snippet from
  SKILL.md so consumers have an immediate fallback.
- **Cross-link from README, not duplicate.** The README already
  contains the org overview and the Renovate model. The runbook adds
  the _imperative_ procedure. Linking from README + SKILL.md keeps
  the canonical content in one place per concern.

## Affected files

| File                                   | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `docs/runbooks/onboard-repo.md`        | New runbook                                              |
| `README.md`                            | Add one cross-link line under the existing repo overview |
| `SKILL.md`                             | Add one cross-link line under "Workflow"                 |
| `docs/plan/0011-onboarding-runbook.md` | This plan                                                |

## Implementation details

### Approach

1. Write `docs/runbooks/onboard-repo.md` with two top-level sections:
   - **Variant A — New repo:** eight numbered steps covering repo
     creation, topic, `pnpm init`, `standards init`, Renovate
     onboarding PR, branch protection (link to `#15` playbook),
     drift PR + open agent gap from `#13`, and the pre-review LLM
     contract from `#19`.
   - **Variant B — Legacy repo onboarding:** same eight steps plus
     an explicit note that the changes/0001 judgement steps
     (Prettier out, oxfmt/oxlint in, scripts convergence) must be
     walked through manually because the initial drift PR will be
     large.
2. Cross-link from the runbook to:
   - `SKILL.md` (agent contract, pull mode, branch protection,
     merge policy)
   - `changes/0001`, `changes/0002`, `changes/0003`, `changes/0004`
     (current changelog set)
   - The `gh api ... branches/main/protection` snippet from
     `SKILL.md#branch-protection-setup`
3. Update `README.md`: add an "Onboarding a new repo" link line in
   the existing structure, pointing at the runbook.
4. Update `SKILL.md`: add one link line in the "Workflow" section
   pointing at the runbook for human maintainers.
5. Verify `pnpm agent:check` stays green — no code changes, only
   docs. `cspell.json` already lists `managed-deps`,
   `repometa`, `oxlint`, `oxfmt`, `pnpm`, `forgejo`; the runbook
   uses only known terms.

### Edge cases

- **Open agent gap (#13):** the runbook calls out explicitly that
  step 7 (await drift PR + agent trigger) is currently partially
  manual. Until the external agent is wired, the maintainer works
  `pending.json` locally — and that fact lives in the runbook, not
  hidden in SKILL.md.
- **Forgejo vs GitHub:** every step that has platform-specific
  syntax (topic, branch protection API) carries a side-by-side
  example. Where Forgejo lags (branch-rules API verification
  deferred per SKILL.md), the runbook says so.
- **Renovate onboarding PR variance:** Renovate may write
  `local>sebastian-software/renovate-config` on the first
  onboarding PR. SKILL.md already documents the canonical
  `github>` form fix; the runbook links to that section rather
  than duplicating the fix.

## Acceptance criteria

- [x] `docs/runbooks/onboard-repo.md` exists with Variant A (new
      repo) and Variant B (legacy) sections.
- [x] Variant A lists eight numbered steps covering repo creation
      → topic → `pnpm init` (if Node) → `standards init` (with all
      flags listed) → Renovate onboarding PR → branch protection
      → drift PR + agent gap → human merge.
- [x] Variant B walks through Variant A plus the changes/0001
      judgement steps for legacy migration.
- [x] Cross-links to `SKILL.md`, `changes/`, and the branch
      protection snippet.
- [x] README links to the runbook.
- [x] SKILL.md links to the runbook from the human-maintainer
      perspective.
- [x] `pnpm agent:check` green (cspell + format:check).

## Validation plan

- `pnpm agent:check` (lint, format:check, typecheck, build, tests,
  `check:self`) — pure doc change, expected to stay green.
- `cspell` covers `managed-deps`, `repometa`, `forgejo`, `pnpm`,
  `oxlint`, `oxfmt`, `dlx` (already in dictionaries).

## Assumptions and open items

- **Assumption:** The branch protection snippet in SKILL.md is
  still current after the `#15` PR landed. (Confirmed by reading
  SKILL.md.)
- **Open:** A companion `scripts/onboard-repo.sh` (or Ansible task
  in the proxmox repo) is intentionally out of scope — flagged in
  the runbook as a follow-up improvement.
- **Open:** Forgejo branch-rules API verification stays deferred
  per the existing SKILL.md note; the runbook calls this out but
  does not block on it.

## Plan review

**Result:** Approved

### Summary

| Area            | Critical | Important | Hint |
| --------------- | -------: | --------: | ---: |
| Architecture    |        0 |         0 |    2 |
| Security        |        0 |         0 |    0 |
| Privacy         |        0 |         0 |    0 |
| Failure modes   |        0 |         0 |    1 |
| Testability     |        0 |         0 |    1 |
| Scope           |        0 |         0 |    2 |
| Maintainability |        0 |         0 |    2 |

### Findings

- **Architecture — hint:** Runbook lives under `docs/runbooks/`
  per the SF doc convention; this is the first runbook in the
  repo and seeds the directory.
- **Architecture — hint:** Cross-link strategy keeps each piece of
  truth in one canonical place. SKILL.md owns the agent contract
  and the `gh api` snippet; the runbook owns the imperative
  procedure.
- **Failure modes — hint:** The open agent gap from `#13` is
  surfaced in step 7 instead of being buried in SKILL.md. Makes
  the manual fallback discoverable.
- **Testability — hint:** No automation tests beyond `cspell`
  vocabulary. A future test could `npx markdown-link-check` the
  runbook; out of scope for this PR.
- **Scope — hint:** Optional `scripts/onboard-repo.sh` is
  deliberately deferred. The runbook flags it as a follow-up.
- **Scope — hint:** Forgejo branch-rules verification deferred per
  SKILL.md. Runbook records the gap.
- **Maintainability — hint:** Two variants in one file keep the
  delta cost low. If a third variant ever appears (e.g.
  documentation-only repo without `package.json`), it slots in
  next to the existing two.
- **Maintainability — hint:** The runbook references changelog
  numbers explicitly (`changes/0001..0004`). When change 0005
  lands, the runbook needs one line of update.

## Test results

- `pnpm agent:check` — green (pure doc change; no code paths
  exercised).

## Review findings

Reviewer: inline self-review (documentation change only). Counts:
0 critical, 0 important, 0 hints — no follow-ups beyond the open
items above.
