# 0014: standards-pr-agent — post failed/incomplete checks as a PR information comment

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

From [#40](https://github.com/sebastian-software/standards/issues/40).

#38 made the run-1 agent run the repo gate in CI mode, treat failures as
non-blocking hints, and always finalize the PR regardless of the outcome. The
`## Validation` block in `buildPrompt` (`src/agent.ts:64-76`) ends with
"Remaining failures are surfaced to the reviewer by the pull request's own CI
run". That is not sufficient: the agent runs the gate in an automated
environment that may lack prerequisites (e.g. environment variables), so its
check results can differ from the PR's own CI run, and those agent-side
failures are currently invisible to the reviewer.

Required behavior — extend the run-1 validation contract: when the agent's gate
run produced any failed or incomplete checks, it posts **one separate
information comment** on the PR that

- lists each failed or incomplete check together with its output, and
- notes that the automated environment may lack prerequisites such as
  environment variables, so a human can verify.

The comment is posted **in addition** to the summary comment, only when there
are failed or incomplete checks (all-pass → no comment), does not change the
always-finalize behavior from #38, and the failures stay recorded in the run
record.

Why Feature: this extends the agent-facing run-1 contract with new observable
behavior, identical in nature to #37/#38 (which were built via `/build`). It
changes the `## Validation` block of `buildPrompt` and the SKILL.md run-1
contract, plus a prompt-content test.

### Scope boundary (in-repo vs external wiring)

Actually posting a PR comment is the external pull-mode agent's job and lives
outside this repo (SKILL.md "Pull-mode agent wiring (open)", agent unwired,
`#13`). This repo owns the authoritative instructions the agent follows: the
`## Validation` block (reaches the agent via the prompt) and the SKILL.md run-1
contract (embedded into the prompt via `${skill}`). This plan changes those
contract surfaces; the runtime posting depends on the external wiring.

## Architecture decisions

- **Put the info-comment instruction in the `## Validation` block AND mirror it
  in SKILL.md run-1.** This follows the #38 precedent, which already references
  the pull request inside the `## Validation` block (the "surfaced by the PR's
  own CI run" line). The block is the agent's focused "what to do with check
  results" instruction, so the comment behavior belongs next to it; SKILL.md
  run-1 keeps the human/wiring-facing contract. (Local `standards sync` has no
  PR, exactly as it already has no PR for the existing "PR's own CI run" line —
  the agent simply has nothing to comment on.)
- **Conditional on failures.** The comment is posted only when at least one
  check failed or could not complete; an all-pass run posts nothing. This is
  the acceptance criterion that prevents comment noise.
- **Additive, finalize unchanged.** The instruction is explicitly "in addition
  to the summary comment" and "does not change the always-finalize behavior",
  so #38's contract is preserved, not replaced.
- **No new code paths in the CLI.** No TypeScript beyond the prompt-string
  change; the CLI does not post comments. Mirrors #38.

## Affected files

| File                     | Change                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent.ts`           | Extend the `## Validation` block: keep the existing no-abort / always-finalize bullets; add an instruction to post one separate PR information comment listing each failed/incomplete check with its output + the env-prerequisites note, only when there are failures. |
| `SKILL.md`               | Run-1 contract: add the info-comment behavior (conditional, additional to the summary comment, finalize unchanged, failures recorded). Cross-reference #40.                                                                                                             |
| `test/standards.test.ts` | Add a `buildPrompt` assertion that the prompt instructs posting the information comment for failed/incomplete checks (mentions the comment, the per-check output, and env prerequisites).                                                                               |

## Implementation details

### Approach

1. In `buildPrompt`'s `## Validation` block, split the final bullet so the
   "complete even if checks fail / never withhold commits" part stays, and add
   a new bullet: if any check failed or could not complete, post one separate
   information comment on the PR listing each such check with its output and
   noting the automated environment may lack prerequisites (e.g. env vars) that
   the PR's own CI run has, so a human can verify; post only on failures; it is
   additional to the summary comment and does not change always-finalize.
2. Mirror the same contract in SKILL.md run-1 (a sentence in the run-1
   paragraph), cross-referencing #40.
3. Add the prompt-content test.

### Edge cases

- **All checks pass:** no information comment (asserted by the "only when there
  are failed or incomplete checks" wording).
- **Incomplete check** (could not run, e.g. missing prerequisite): treated like
  a failure for the purpose of the comment — explicitly covered by "failed or
  incomplete".
- **Local `standards sync` (no PR):** nothing to comment on; the agent posts
  nothing, exactly as it already does nothing with the existing PR-CI line.

## Acceptance criteria

- [x] `buildPrompt` output instructs run 1 to post one separate PR information
      comment listing each failed/incomplete check with its output and the
      env-prerequisites note, **only** when there are failed/incomplete checks.
- [x] The instruction states it is additional to the summary comment and does
      not change the always-finalize behavior from #38.
- [x] SKILL.md run-1 documents the same conditional info-comment behavior.
- [x] `pnpm agent:check` is green.

## Validation plan

- **Unit:** new `buildPrompt` test asserting the info-comment instruction and
  the env-prerequisites note are present.
- **Full gate:** `pnpm agent:check` (lint + format + typecheck + build + tests
  - `check:self`).
- **Manual:** `node dist/cli.js sync --dry-run --cwd <fixture>` shows the
  extended `## Validation` block.

## Assumptions and open points

- The external pull-mode agent is still unwired (`#13`); this plan tightens the
  contract it will implement. The actual comment posting is verifiable only
  once the wiring exists.
- "Summary comment" and "run record" are external-agent concepts; this repo
  only references them in the contract. No such artifacts are produced by the
  CLI.
- No `PendingPayload` schema change; the change is prompt/contract text only.

## Plan review

**Result:** Approved

### Summary

| Area          | Critical | Important | Hint |
| ------------- | -------: | --------: | ---: |
| Architecture  |        0 |         0 |    2 |
| Security      |        0 |         0 |    0 |
| Privacy       |        0 |         0 |    1 |
| Failure modes |        0 |         0 |    1 |
| Testability   |        0 |         0 |    1 |
| Scope         |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** Placing the instruction in the `## Validation` block
  follows the #38 precedent (which already references the PR there) rather than
  re-architecting the block/SKILL split.
- **Architecture — hint:** Mirroring in SKILL.md keeps the human/wiring contract
  in sync; both reach the agent via the prompt.
- **Privacy — hint:** The comment includes check output verbatim; for the
  standards flow that is build/lint/test output, no secrets expected — the
  env-prerequisites note explains absence, it does not print env values.
- **Failure modes — hint:** "Incomplete" checks (could not run) are explicitly
  covered alongside "failed", so a missing-prerequisite check is reported, not
  silently dropped.
- **Testability — hint:** The instruction is verifiable by asserting the prompt
  contains the comment directive and the env-prerequisites note.
- **Scope — hint:** No CLI code path or schema change; contract text only,
  matching #38's blast radius.

## Test results

- `pnpm agent:check` — green (lint + format + typecheck + build + **75 tests**
  - `standards check` self-check).
- New test in `test/standards.test.ts`: `buildPrompt` output instructs run 1 to
  post the information comment — asserts the directive (`information comment`),
  the incomplete-check wording (`could not complete`), the env-prerequisites
  note (`may lack prerequisites`, `environment variables`), the conditional
  (`post no such comment`), and the distinguishing clauses vs. #38
  (`in addition to the summary`, `always-finalize`).
- Manual: `node dist/cli.js sync --dry-run` shows the extended `## Validation`
  block (the prompt embeds both the block and SKILL.md run-1).

## Review findings

**Date:** 2026-06-20
**Reviewer:** sf-frontend-workflows:nodejs-reviewer

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     2 |
| Open / Not implemented |     0 |

No critical or important findings. Five hints; two addressed during this
workflow (stronger, context-bound test anchors plus assertions for the
additive / always-finalize clauses). The remaining three are deliberate
trade-offs: the "above" antecedent is clear enough in context; the minor
block↔SKILL wording divergence is intentional (run 1 does not know run 2), and
one finding was a false alarm (the pre-change line the reviewer grepped only in
plan files had already been replaced in `agent.ts`). No external review report —
nothing left open.
