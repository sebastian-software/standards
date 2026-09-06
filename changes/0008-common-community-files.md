# 0008 — Common community files, issue forms, PR template, CLAUDE pointer

- **Scopes:** common
- **Standards version:** 8

## Intent

Give every managed repository the same community baseline — security policy,
code of conduct, support guide, code owners, issue forms, pull-request template
and a `CLAUDE.md` pointer at `AGENTS.md` — plus one org-wide issue label
taxonomy to migrate the existing per-repo ones onto.

## Problem

The 2026-09 audit of ten repositories found the common-scope hygiene files
spread over four different shapes:

- `SECURITY.md` existed in six repos with three different reporting channels
  (GitHub private advisories, `info@sebastian-software.de`,
  `security@sebastian-software.de`) and supported-version statements that had
  gone stale (`0.9.x`, "pre-1.0" on a 3.4.2 release).
- `CODE_OF_CONDUCT.md` existed twice, with two different custom texts;
  `SUPPORT.md` once; `CODEOWNERS` once.
- Issue templates were YAML forms in five repos, legacy Markdown in one, absent
  in four. Pull-request templates existed in six, two with checklists narrower
  than what CI actually enforces.
- Agent guidance was `CLAUDE.md` only, `AGENTS.md` only, `CONTEXT.md`, or
  nothing — so the two tool families read different files.
- Labels used four different priority spellings (`priority:P0`, `priority:low`,
  `priority: P2`, `P3`), two subsystem prefixes (`area:`, `category:`) and three
  colors for `epic`; five repos used the GitHub defaults only.

Every one of these is org-wide policy, not a per-repository decision, so they
belong in the common scope.

Separately, the standards-owned marker sections ended flush against their
`:end` marker. oxfmt 0.66 and newer insert a blank line there when the section
body ends in a list — which the Consumer AGENTS text does — so the formatter and
`standards apply` overwrote each other on every run. Palamedes worked around it
by putting `AGENTS.md` into `.prettierignore`.

## Mechanical steps (covered by `standards apply`)

Ten new seeded entries in the `common` scope. Seeded means created once — a repo
that already has the file keeps its own version untouched.

Platform-independent:

- `reference/common/security.md` → `SECURITY.md`
- `reference/common/code-of-conduct.md` → `CODE_OF_CONDUCT.md`
- `reference/common/support.md` → `SUPPORT.md`
- `reference/common/claude-pointer.md` → `CLAUDE.md`

`platform: "github"` only (Forgejo resolves code owners and issue templates from
different paths; a Forgejo variant follows when the first Forgejo consumer
repository opts in):

- `reference/common/codeowners` → `.github/CODEOWNERS`
- `reference/common/github-issue-template-bug-report.yml` →
  `.github/ISSUE_TEMPLATE/bug_report.yml`
- `reference/common/github-issue-template-feature-request.yml` →
  `.github/ISSUE_TEMPLATE/feature_request.yml`
- `reference/common/github-issue-template-question.yml` →
  `.github/ISSUE_TEMPLATE/question.yml`
- `reference/common/github-issue-template-config.yml` →
  `.github/ISSUE_TEMPLATE/config.yml`
- `reference/common/github-pull-request-template.md` →
  `.github/pull_request_template.md`

`reference/common/labels.json` ships as reference data only. `standards apply`
does not create or rename labels; see the judgement steps below.

Both marker sections (`sebastian-software-branding` in `README.md`,
`sebastian-software-consumer-agents` in `AGENTS.md`) are re-rendered with a
blank line before the `:end` marker. `standards check` reports the old shape as
an outdated section once; `standards apply` rewrites it. The new shape is stable
under oxfmt 0.57 and 0.66 alike, so the formatter and `apply` stop fighting.

## Judgement steps (agent work, common scope)

1. **Merge an existing `SECURITY.md`.** Keep the repository-specific scope
   section (the concrete in-scope and out-of-scope examples) — it is the part
   worth having. Replace the supported-versions section with the reference
   wording ("the latest release on the default branch"): a version-pinned
   statement such as `0.9.x` or "pre-1.0" goes stale silently and was wrong in
   two repos at audit time. Make sure both private channels are named, GitHub
   private vulnerability reporting **and** `security@sebastian-software.de`, and
   replace any other reporting address (for example `info@sebastian-software.de`)
   with it. Keep the 7-day acknowledgement / 14-day assessment expectations.
2. **Merge an existing `CODE_OF_CONDUCT.md`.** Where the repository already has
   a custom text, keep the reference structure (Expected behavior / Unacceptable
   behavior / Scope and enforcement / Reporting) and fold repo-specific
   prohibitions into "Unacceptable behavior" instead of dropping them. Do not
   swap a working custom text for a boilerplate copy of a different one. The
   Reporting section must keep both routes: the maintainers for everyday
   reports, and `security@sebastian-software.de` — a private inbox at Sebastian
   Software GmbH — for reports that concern a maintainer. A code of conduct that
   only says "report to the maintainers" leaves the case that matters most
   without a route.
3. **Merge an existing `SUPPORT.md`.** Keep repository-specific channels (for
   example a domain-specific report form) as extra sections; make sure the
   security section points at `SECURITY.md` and never invites a public issue.
4. **Point the security contact link at this repository.** The seeded
   `.github/ISSUE_TEMPLATE/config.yml` carries a repo-independent link to
   GitHub's private-reporting documentation, because seeded files are copied
   verbatim and cannot be templated per repository. Replace the `url` with
   `https://github.com/sebastian-software/<repo>/security/advisories/new` and
   make sure private vulnerability reporting is enabled in the repository
   settings. Keep `blank_issues_enabled: false`.
5. **Replace legacy Markdown issue templates.** Where
   `.github/ISSUE_TEMPLATE/*.md` files exist, port their fields into the seeded
   YAML forms and delete the Markdown ones — `standards apply` never deletes
   files it does not manage, so both sets would otherwise show up in the issue
   chooser.
6. **Merge an existing pull-request template.** Keep the repository-specific
   validation checklist (the exact `cargo`/`pnpm` commands), and make sure it is
   not narrower than what CI enforces. Add the `Issue` section if it is missing.
   A repository using the uppercase `.github/PULL_REQUEST_TEMPLATE.md` keeps
   that filename; do not end up with both.
7. **Make `AGENTS.md` the canonical agent file.** `CLAUDE.md` is seeded as the
   single line `@AGENTS.md`. Where the repository already has a `CLAUDE.md` (or
   a `CONTEXT.md`) with real content, move that content into `AGENTS.md` —
   outside the standards-owned `sebastian-software-consumer-agents` markers —
   and reduce `CLAUDE.md` to the pointer. Where `AGENTS.md` already carries the
   same guidance, delete the duplicate instead of merging it twice.
8. **Adopt `CODEOWNERS`.** The seed assigns everything to
   `@sebastian-software/maintainers`. Verify the team exists and has write
   access; if the repository needs finer ownership, add the specific paths
   _below_ the catch-all line rather than replacing it. GitHub applies the
   **last** matching pattern, so a specific rule placed above `*` is silently
   overridden by the catch-all.
9. **Migrate labels.** Apply the taxonomy from
   `reference/common/labels.json` with `gh label` (see
   [README.md#label-taxonomy](../README.md#label-taxonomy)); rename rather than
   recreate, so open issues keep their labels. The `migrations` array maps the
   existing spellings (`priority:low`, `priority: P2`, bare `P3`, `category:`)
   onto the taxonomy. Values of the `area:` prefix stay repository-specific —
   pick them from the repository's actual subsystems. Use `Epic: …` as the title
   convention for issues labeled `epic`.

10. **Drop the marker-section formatter workaround.** A repository that added
    `AGENTS.md` (or `README.md`) to a repo-local `.prettierignore` only because
    oxfmt and `standards apply` disagreed about the blank line before the `:end`
    marker can remove that entry after this version — the rendered section is
    now what oxfmt produces. Keep entries that exist for any other reason.

## Notes

- Seeded files are owned by the repository. A later content change to any of
  these references needs its own changelog entry with an explicit merge
  strategy; `standards apply` never rewrites a seeded file after first creation.
- The reference texts are deliberately short and repository-independent: they
  name "this repository's Security tab" rather than a URL, so no per-repo
  templating is needed. `src/apply.ts` copies seeded files verbatim and does not
  run them through `renderTemplate`.
- The label taxonomy is documentation plus data, not a CLI command. Automating
  label sync (an org `.github` repository, or a `standards labels` command) is a
  possible follow-up; nothing in this version depends on it.
- The branding footer still loads its logo from `sebastian-brand.vercel.app`.
  Moving it to a stable host is tracked separately — it needs the SVG or a
  verified alternative URL, neither of which is settled here.
