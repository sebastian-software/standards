# 0007 - Consumer AGENTS guardrails for managed files

- **Scopes:** common
- **Standards version:** 7

## Intent

Put the managed-file and formatter guardrails where agents working inside
consumer repositories actually read them: the repo-local `AGENTS.md`.

## Problem

`SKILL.md` guides the standards apply agent, not a normal feature or fix agent
inside a standards-consuming repository. That agent can make `pnpm agent:check`
green while still changing a managed file such as `.oxfmtrc.json`; the drift
then appears only when CI runs `standards check`.

Generated artifacts are a common trigger. Agents should generally fix or format
files reported by `oxfmt`, and generated files should be formatted in the
generator step when possible. A repo-local `.prettierignore` is only the
fallback when the artifact cannot reasonably be formatted; repo-specific ignore
paths do not belong in managed `.oxfmtrc.json`.

## Mechanical steps (covered by `standards apply`)

- Upsert the standards-owned `sebastian-software-consumer-agents` section in
  `AGENTS.md` from `CONSUMER-AGENTS.md`.

## Judgement steps (agent work, common scope)

1. **Preserve repo-local `AGENTS.md` content.** Keep instructions outside the
   standards-owned marker section intact. Do not remove local guidance unless it
   directly contradicts the new managed-file guardrail.
2. **Follow the guardrail in future work.** Do not hand-edit managed files or
   standards-owned marker sections. When `oxfmt` reports a file, fix or format
   it first; use `.prettierignore` only when formatting is not viable.

## Notes

- `pnpm agent:check` is repo-local and may not include `standards check`; CI can
  still fail on managed drift.
- The Consumer AGENTS text is intentionally short to avoid unnecessary context
  load in consumer repositories.
