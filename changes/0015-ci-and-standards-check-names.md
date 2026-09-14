# 0015 — Explicit CI and standards consistency checks

- **Scopes:** node, rust
- **Standards version:** 15

## Intent

Give the two repository-wide quality gates stable, descriptive GitHub Actions
check names:

- `CI / Check` runs the repository's normal lint, format, typecheck, build and
  test commands.
- `Standards / Consistency` runs `standards check` and reports drift against
  the published repository standards.

The old names `check` and `Standards drift` were too generic for a required
status check and did not explain what the check protects.

## Mechanical steps

The Node GitHub and Forgejo reference workflows now expose the two jobs
separately. The Rust CI reference uses the same name for its standards gate.
The standards repository follows the same split. `check:ci` runs its ordinary
checks; `agent:check` remains the complete local gate, including `check:self`.
CI invokes `check:ci` and runs `check:self` once in the separate standards job.

`standards apply` already provides the intended local migration command. It
updates managed files, seeds missing files and advances `.repometa.json`; it
does not overwrite an existing seeded workflow, so existing repositories must
adopt the renamed jobs in their workflow migration PR before changing their
required status-check names.

## Required status checks

Repositories using the new workflow should require these exact check names:

```text
CI / Check
Standards / Consistency
```

Existing branch protections must be migrated together with their workflow.

For this repository, a temporary `check` job depends on both new jobs and
fails if either fails, is cancelled, or is skipped. This preserves the existing
required check until branch protection is migrated. Require both new names
before removing the bridge. Consumer repositories must likewise retain their
old required job as an aggregate until their protection settings are migrated.

The Node standards job owns the pending, blocked-marker and CLI-alignment
guards, including the exact-pin validation introduced in version 14. Keep all
of these guards when adapting an existing workflow. The Rust workflow keeps
its other job names; only its standards job is renamed.
