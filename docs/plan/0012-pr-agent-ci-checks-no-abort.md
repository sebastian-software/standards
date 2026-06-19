# 0012: standards-pr-agent — CI-mode checks as hints, always push to the PR

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

From [#37](https://github.com/sebastian-software/standards/issues/37).

The standards pull-mode agent (run 1) currently works through
`.standards/pending.json`, commits the judgement changes, deletes the
marker, and flips the label — **without ever running the consumer
repo's own quality gate** (`buildPrompt` in `src/agent.ts` says nothing
about checks; SKILL.md "Agent run 1 — mechanics" lists no check step).
The external wiring that does run checks aborts on the first failing
check. Two failure modes follow:

1. Checks that need a local developer environment (unset deploy or
   connection environment variables) fail in the agent context even
   though the repository is fine, so the PR is left unprocessed.
2. A single failing check aborts the whole run instead of being used as
   fix guidance.

Required behavior:

1. **Run validation as CI.** Provide CI-appropriate environment, prefer
   the `agent:check:ci` script when present, fall back to `agent:check`.
   This removes "missing local development environment" as a failure
   cause and makes the hints accurate.
2. **Do not abort on check failures.** Run the checks, collect their
   output, and use it as guidance to improve the changes while applying
   the individual changesets.
3. **Always push the agent's work to the PR.** The checks are advisory
   hints to improve the changes, **not** a merge gate. After making its
   best-effort changes the agent always pushes the new commits to the PR
   branch and completes the run-1 handoff (delete the marker, flip the
   label) regardless of the check outcome. The PR's own full CI run
   (e.g. on GitHub) plus human review are the actual gate — the
   developer reviews and, if appropriate, merges.

   > **Divergence from #37.** The issue text says "finalize only on a
   > passing final state" and "leave the pull request untouched" on
   > failure. Per maintainer decision (2026-06-19) this is reversed:
   > commits are always pushed and the gate moves to the PR CI run +
   > human review. The issue wording should be updated to match before
   > it is closed.

Why Feature: the deliverable extends the run-1 prompt contract
(`src/agent.ts#buildPrompt`), adjusts `runAgent`, updates the SKILL.md
wiring contract, and adds tests. This is new agent behavior, not a pure
documentation edit and not a localized bug fix.

### Scope boundary (in-repo vs external wiring)

The agent runtime and PR orchestration — environment-variable
provisioning, `git push`, PR comment, and label mutation — live
**outside this repo** (SKILL.md "Pull-mode agent wiring (open)" and
"External wiring follow-up"; the agent is still unwired, see `#13`).
This repo owns the **authoritative instructions** the agent follows.
This plan therefore changes the contract surfaces here; the runtime
parts still depend on the external wiring honoring the contract.

## Architecture decisions

- **Encode the CI-check + no-abort instructions in `buildPrompt`
  output, not in a new file.** Run 1 is "anchored indirectly via
  `buildPrompt`" (SKILL.md). Embedding keeps a single run-1 prompt
  source shared by the local `standards sync` fallback and the external
  run 1. (Alternative considered: a versioned `reference/agent/run1-*.md`
  mirroring `review-prompt.md`; rejected for now to avoid a second
  source of truth for run 1 — revisit only if run 1 ever needs
  out-of-band rendering the way run 2 does.)
- **Checks are hints, not a gate.** The agent runs the gate to learn
  what to improve, makes best-effort fixes, and then always hands the
  result off. The PR's own CI run plus human review decide mergeability.
  No "complete only on green" logic is introduced anywhere.
- **Keep `buildPrompt` context-agnostic.** The check loop (prefer
  `pnpm agent:check:ci`, else `pnpm agent:check`; run to completion; use
  the output to improve the changes) is safe in both the local-sync and
  the PR context. The PR-only handoff actions (push / comment / label)
  are described in SKILL.md as wiring obligations and are **not** baked
  into the prompt — the local fallback must never push or mutate labels.
- **CI env for the local fallback.** Have `runAgent` spawn the agent
  with `CI=true` (preserving `process.env`) so `standards sync`
  exercises the same `:ci` path. Minimal and harmless; the heavy env
  provisioning (deploy/connection secrets) remains an external-wiring
  responsibility the prompt cannot conjure.
- **Script preference is resolved by the agent at runtime**, not by the
  CLI. The prompt states the order (`agent:check:ci` → `agent:check`);
  no script-existence probing is added to TypeScript, keeping `agent.ts`
  free of `package.json` inspection.

## Affected files

| File                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent.ts`           | Extend `buildPrompt` output with a "Validation" block: run the gate in CI mode, `agent:check:ci` → `agent:check` preference, no-abort, treat output as hints to improve the changes (best effort). In `runAgent`, add `CI=true` to the `spawnSync` env (keep `stdio: "inherit"`).                                                                                                                                            |
| `SKILL.md`               | Update "Agent run 1 — mechanics" (pipeline list ~lines 107-110 and "Two runs, one external wiring" ~lines 182-188): require CI-mode checks and the no-abort, checks-as-hints loop; state that commits are **always** pushed and the handoff always completes, with the PR's own CI run + human review as the gate; document the env-provisioning obligation as external wiring. Cross-reference #37 and the divergence note. |
| `test/standards.test.ts` | Extend the existing `buildPrompt` test (~line 149) with `toContain` assertions for the new instructions; add a `runAgent` env assertion if a test seam exists without spawning real binaries.                                                                                                                                                                                                                                |
| `changes/`               | Optional changelog entry — open point (see Assumptions). The contract change targets the agent, not consumer-repo files, so a bump entry may be unnecessary.                                                                                                                                                                                                                                                                 |

## Implementation details

### Approach

1. Append a delimited section to the `buildPrompt` return string (e.g. a
   `## Validation` heading) instructing the agent: after applying the
   judgement steps, run the repo gate in CI mode — prefer
   `pnpm agent:check:ci`, fall back to `pnpm agent:check` if the `:ci`
   script is absent; run to completion rather than stopping at the first
   failure; treat the output as hints and make best-effort fixes while
   applying the changesets. The run is complete after best-effort fixes
   **regardless** of remaining failures — remaining failures are
   surfaced to the reviewer by the PR's own CI run, not by withholding
   the commits.
2. In `runAgent`, pass `env: { ...process.env, CI: "true" }` to
   `spawnSync` so the local `standards sync` fallback runs checks in CI
   mode as well.
3. Update the SKILL.md run-1 contract to mirror 1–2 and to state that
   the handoff (push / comment / label) **always** completes; the gate
   is the PR CI run + human review, an external responsibility.
4. Update tests.

### Edge cases

- **Neither `agent:check:ci` nor `agent:check` defined:** the agent
  notes that no gate is available, proceeds with best-effort changes,
  and still pushes; there are simply no hints to act on.
- **`:ci` present but failing:** the agent uses the output to improve
  the changes and still pushes; remaining failures show up in the PR's
  own CI run for the reviewer.
- **Local `standards sync` (no PR context):** the handoff wording must
  not induce `git push` or label changes; locally the agent only edits /
  commits. This is why handoff lives in SKILL.md, not the shared prompt.
- **Secrets still missing under CI mode:** documented as a wiring
  responsibility; out of scope for the prompt.

## Acceptance criteria

- [x] `buildPrompt` output contains the CI-mode gate instruction with
      the `agent:check:ci` → `agent:check` preference order.
- [x] `buildPrompt` output instructs no-abort and "treat check output as
      hints to improve the changes (best effort)", with no green-gate on
      completion.
- [x] `runAgent` spawns the agent with `CI=true` in its environment.
- [x] SKILL.md run-1 contract documents CI-mode checks, the no-abort
      checks-as-hints loop, the always-push handoff, and the external
      env-provisioning obligation.
- [x] Tests assert the new prompt content (and the CI env where
      testable) and `pnpm agent:check` is green.

## Validation plan

- **Unit:** extend the `buildPrompt` test with `toContain` assertions
  for the new instruction block; if practical, a `runAgent` test that
  captures the spawn env (may need a small injection seam — note in
  implementation, do not over-engineer).
- **Full gate:** `pnpm agent:check` green (lint + format:check +
  typecheck + build + tests + `check:self`).
- **Manual:** `node dist/cli.js sync --dry-run --cwd <fixture>` prints
  the new validation block.

## Assumptions and open points

- Issue #37's written requirement 3 ("finalize only on a passing final
  state") is intentionally **not** implemented as stated — see the
  divergence note. The issue should be reworded to "always push; gate is
  PR CI + human review" before closing.
- The external pull-mode agent is still unwired (`#13`). This plan
  tightens the contract it will implement; the runtime parts (CI env,
  push, comment, label) are verifiable only once the wiring exists.
- Decided during `/build`: **no** `changes/000N-*.md` changelog entry is
  shipped. The change is to the agent contract (prompt + SKILL.md), not to
  any consumer-repo file, so a standards-version bump would propagate no
  mechanical work.
- `runAgent` env change is intentionally limited to `CI=true`; richer CI
  env (deploy/connection vars) stays external.
- A separate versioned run-1 template is deferred unless run 1 gains an
  out-of-band rendering need (parity with run 2's `review-prompt.md`).

## Plan review

**Result:** Approved

### Summary

| Area          | Critical | Important | Hint |
| ------------- | -------: | --------: | ---: |
| Architecture  |        0 |         0 |    2 |
| Security      |        0 |         0 |    1 |
| Privacy       |        0 |         0 |    0 |
| Failure modes |        0 |         0 |    1 |
| Testability   |        0 |         1 |    0 |
| Scope         |        0 |         1 |    1 |

### Findings

- **Scope — important:** Requirement 3 in the issue text contradicts the
  maintainer's intent. Addressed by reversing it in the plan (always
  push; gate = PR CI + human review) and recording an explicit
  divergence note plus an open point to reword the issue. The runtime
  parts (env, push, comment, label) remain external (`#13`) and are
  therefore not fully testable in this repo.
- **Testability — important:** `runAgent` is hard to test without
  spawning a real binary. Addressed by making the `runAgent` env
  assertion conditional on a cheap seam and treating the `buildPrompt`
  `toContain` assertions as the primary, reliable coverage.
- **Architecture — hint:** Mixing the context-agnostic check loop with
  the PR-only handoff in one prompt risks the local fallback pushing or
  mutating labels. Mitigated by keeping handoff wording in SKILL.md and
  only the check loop in `buildPrompt`.
- **Architecture — hint:** Embedding run-1 instructions in `buildPrompt`
  rather than a `reference/agent/` template keeps a single source of
  truth; the alternative is documented and deferred.
- **Failure modes — hint:** "No gate script defined" and "gate failing"
  both resolve to the same safe behavior — best-effort changes are still
  pushed and the PR CI surfaces any remaining problems.
- **Security — hint:** No new credential surface is introduced in-repo;
  `CI=true` only toggles the consumer's existing CI code path.
- **Scope — hint:** A consumer-facing changelog entry is deliberately
  left as an open decision rather than assumed in.

## Test results

- `pnpm agent:check` — green (lint + format:check + typecheck + build +
  **73 tests** + `standards check` self-check).
- New tests in `test/standards.test.ts`:
  - `buildPrompt` contains the `## Validation` block with the
    `agent:check:ci` → `agent:check` preference and the non-blocking,
    no-abort wording ("Do not stop at the first failing check", "never
    withhold or revert your commits").
  - `buildAgentEnv` forces `CI=true`, overrides an inherited `CI=false`,
    and preserves other env vars — covering the `runAgent` CI-mode
    acceptance criterion via an extracted, testable seam.
- Manual: `node dist/cli.js sync --dry-run` emits the new validation
  block (covered indirectly by `dispatchAgent` printing the prompt).

## Review findings

**Date:** 2026-06-19
**Reviewer:** sf-frontend-workflows:nodejs-reviewer

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     2 |
| Open / Not implemented |     1 |

Resolved during this workflow: F2 (SKILL.md run-1 reinforced with "PR
branch, never the default branch") and F5 (`buildAgentEnv` seam + unit
test). Four hint-level findings were acknowledged as deliberate
trade-offs (intentional `CI` override; test DRY/brittleness; reviewer
could not run the gate). One **important** finding is pre-existing and
out of scope and was exported.

**External review report:** `.sf-plugin/review/review-report-2026-06-19-plan-0012.md`
(R-0000033 — `runAgent` `--allowedTools` argv form may not parse as one
allowlist; verify against the installed Claude CLI before wiring run 1).
