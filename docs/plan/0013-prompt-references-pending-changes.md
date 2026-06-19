# 0013: Reference pending.json changes from the prompt instead of duplicating them

**Plan status:** Implemented
**Source:** /plan
**Recommended workflow:** Feature (`/build`)

## Requirement

Observed on
[listwerk#30](https://github.com/sebastian-software/listwerk/pull/30): the
generated `.standards/pending.json` carries every changelog body **twice**.
`buildPendingPayload` (`src/sync.ts:186-207`) builds the `prompt` field via
`buildPrompt`, which embeds the full changelog text (`changeSections`,
`src/agent.ts:22-24,41-43`), and it additionally stores the same text in the
structured `changes[].content` array. For a multi-entry bump the marker file
roughly doubles in size for no benefit, and a human reading the diff sees the
same content rendered twice.

Goal: the `prompt` field should contain only the **instructions** and point at
the `changes` array of `.standards/pending.json` for the changelog bodies; the
full bodies live solely in `changes[].content`.

### Constraint that shapes the design

`buildPrompt` has **two** callers:

1. `buildPendingPayload` (`src/sync.ts`) — the Renovate flow. The prompt ends
   up inside `pending.json` **next to** the `changes` array, so it can safely
   reference that array.
2. `syncCommand` (`src/cli.ts`) → `runAgent` — the local `standards sync`
   fallback. Here there is **no** `pending.json` on disk; the agent receives
   the prompt directly as an argv string. This prompt must stay
   self-contained (changelog bodies embedded), or the agent has nothing to act
   on.

So the fix is not "stop embedding changes" globally — it is "embed inline for
the self-contained sync prompt, reference the array for the pending-file
prompt".

Why Feature: this changes the agent-facing input contract (the `pending.json`
`prompt` format and the run-1 expectation that bodies are read from the
`changes` array), with a code change to `buildPrompt`/`buildPendingPayload`,
tests, and a SKILL.md contract note. It is more than an internal refactor.

## Architecture decisions

- **Add a changes-source mode to `buildPrompt`, default `inline`.** Introduce
  a discriminator (e.g. `changesSource: "inline" | "pending-file"` on
  `PromptInput`, optional, defaulting to `"inline"`). Only the
  "## Changelog entries to execute" section branches on it; intro, context,
  embedded `SKILL.md`, and the "## Validation" block stay identical. Keeping
  `inline` the default means `syncCommand` and the existing self-contained
  behavior need no change.
- **`pending-file` mode references the array, with a lightweight index.** In
  `pending-file` mode the section omits the bodies and instead instructs the
  agent: the changelog entries to execute are in the `changes` array of
  `.standards/pending.json` (each entry has `file`, `version`, `scopes`,
  `content`). A short index of `- <file> (v<version>)` lines is included for
  orientation — filenames/versions are tiny and already in `changes[]`, so
  this is negligible duplication, unlike the full bodies. The heavy
  `content` is referenced, not repeated.
- **`buildPendingPayload` uses `pending-file`.** It is the only caller that
  ships the prompt alongside the array, so it is the only one that switches
  modes. `changes[].content` is unchanged — it remains the single source of
  the full bodies.
- **No schema-version bump.** The `PendingPayload` shape is unchanged (same
  fields, same `schemaVersion: 1`); only the textual content of the existing
  `prompt` field changes. The validators in `src/sync.ts` need no change.

## Affected files

| File                     | Change                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent.ts`           | Add optional `changesSource` to `PromptInput`; branch the "Changelog entries to execute" section between inline bodies (default) and a reference-to-`pending.json` index. No other section changes. |
| `src/sync.ts`            | `buildPendingPayload` calls `buildPrompt` with `changesSource: "pending-file"`. `changes[]` array untouched.                                                                                        |
| `SKILL.md`               | Run-1 contract note: in the Renovate flow the prompt references the `changes` array of `.standards/pending.json`; the agent reads the full changelog bodies from there.                             |
| `test/standards.test.ts` | Add a `buildPrompt` test for `pending-file` mode (no bodies, references the array); extend the `buildPendingPayload` test to assert `prompt` omits bodies while `changes[].content` keeps them.     |

## Implementation details

### Approach

1. Extend `PromptInput` with `changesSource?: "inline" | "pending-file"`.
2. In `buildPrompt`, compute the changelog section by mode:
   - `inline` (default): current `### <file>\n\n<content>` rendering.
   - `pending-file`: a short index (`- <file> (v<version>)`) plus a sentence
     telling the agent to read each entry's full `content` from the `changes`
     array in `.standards/pending.json`.
3. In `buildPendingPayload`, pass `changesSource: "pending-file"`.
4. Update SKILL.md run-1 wording.
5. Update/extend tests.

### Edge cases

- **No pending changes:** `buildPendingPayload` still returns `undefined`
  early; nothing rendered. Unchanged.
- **Local `standards sync`:** uses the default `inline` mode → prompt stays
  self-contained; no `pending.json` dependency introduced.
- **Single vs many entries:** index lists one or many lines; the reference
  sentence is identical.

## Acceptance criteria

- [x] In `pending-file` mode, `buildPrompt` output does **not** contain
      changelog bodies and explicitly references the `changes` array in
      `.standards/pending.json`.
- [x] `buildPrompt` default (`inline`) output is byte-for-byte the current
      behavior (existing test still green).
- [x] `buildPendingPayload().prompt` no longer embeds changelog bodies, while
      `changes[].content` still carries the full bodies (no duplication).
- [x] SKILL.md run-1 documents that the prompt references the `changes` array.
- [x] `pnpm agent:check` is green.

## Validation plan

- **Unit:** new `buildPrompt` `pending-file` test; extended
  `buildPendingPayload` test asserting body text appears only in
  `changes[].content`, not in `prompt`.
- **Full gate:** `pnpm agent:check` (lint + format + typecheck + build +
  tests + `check:self`).
- **Manual:** `node dist/cli.js apply --from-version 0 --emit-pending /tmp/pending.json --cwd <fixture>`
  then inspect `/tmp/pending.json` — bodies appear once (in `changes`).

## Assumptions and open points

- Listing `file (vN)` in the prompt index is intentional minor duplication
  (metadata only) for agent orientation. If even that is unwanted, drop the
  index and keep a pure reference — trivial follow-up.
- No `PendingPayload` schema change, so existing consumers/validators and the
  `assertPendingPayload` guard are unaffected.
- The external run-1 wiring (#13) already loads the whole `pending.json`, so it
  has the `changes` array available; this change does not add a new fetch.

## Plan review

**Result:** Approved

### Summary

| Area          | Critical | Important | Hint |
| ------------- | -------: | --------: | ---: |
| Architecture  |        0 |         0 |    2 |
| Security      |        0 |         0 |    0 |
| Privacy       |        0 |         0 |    0 |
| Failure modes |        0 |         0 |    1 |
| Testability   |        0 |         0 |    1 |
| Scope         |        0 |         0 |    1 |

### Findings

- **Architecture — hint:** A single `buildPrompt` with a mode flag is
  preferred over a second function to avoid duplicating the intro / context /
  SKILL / validation template.
- **Architecture — hint:** Keeping `inline` the default confines the behavior
  change to the one caller that ships the array (`buildPendingPayload`).
- **Failure modes — hint:** The self-contained local-sync prompt is the reason
  bodies cannot simply be dropped from `buildPrompt`; the mode flag preserves
  it.
- **Testability — hint:** Duplication is verifiable by asserting a known body
  substring is absent from `prompt` but present in `changes[].content`.
- **Scope — hint:** No schema-version bump and no change to `changes[]` keep
  the blast radius to the `prompt` text only.

## Test results

- `pnpm agent:check` — green (lint + format + typecheck + build + **74 tests**
  - `standards check` self-check).
- New / extended tests in `test/standards.test.ts`:
  - `buildPrompt` `pending-file` mode: references `.standards/pending.json`,
    emits the `- <file> (vN)` index, embeds **no** changelog body.
  - `buildPrompt` default (`inline`) mode: now positively asserts every
    changelog body is embedded — the differential counterpart.
  - `buildPendingPayload`: `prompt` references the array and contains no body;
    `changes[].content` still carries the full (non-empty) bodies.
- Manual: `apply --from-version 0 --emit-pending .standards/pending.json` on a
  fixture — the emitted `prompt` contains no changelog body (verified
  programmatically), the ~11.5 KB of bodies appear only once in `changes[]`.

## Review findings

**Date:** 2026-06-19
**Reviewer:** sf-frontend-workflows:nodejs-reviewer

### Summary

| Status                 | Count |
| ---------------------- | ----: |
| Resolved               |     3 |
| Open / Not implemented |     0 |

No critical or important findings. Three hints, all resolved during this
workflow: the two test-robustness hints (negative-only assertions) were
addressed by making the inline/pending-file tests a differential pair with
non-empty-body guards; the field-list drift hint was addressed with a
`keep in sync` comment next to the prompt's field list. No external review
report needed — nothing left open.
