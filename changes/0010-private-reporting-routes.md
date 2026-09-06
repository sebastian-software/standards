# 0010 — Private reporting routes that actually resolve

- **Scopes:** common
- **Standards version:** 10

## Intent

Make every private reporting route named by the community seeds a destination a
reader can actually reach, in a repository whose owner has not turned on any
GitHub setting yet.

## Problem

The first `standards apply` pass with version 9 put the seeds into ten
repositories, and the review of those pull requests found two dead ends
(sebastian-software/standards#68, first raised on
sebastian-software/ferriki#107):

- `CODE_OF_CONDUCT.md` offered "the repository maintainers, through GitHub" as
  the everyday private route. GitHub has no private message channel to a
  repository's maintainers — no inbox, no form. A reporter following that route
  has nowhere to go, and the one concrete address in the file was the
  escalation inbox, which the text framed as the exception.
- `.github/ISSUE_TEMPLATE/config.yml` offered exactly one security route, and
  after the judgement step from change 0008 it points at
  `…/security/advisories/new`. That URL 404s until the repository owner enables
  private vulnerability reporting, which is a per-repository GitHub setting the
  CLI cannot set and the seed cannot know about. The route that always works —
  the email inbox from `SECURITY.md` — was not offered at all.

Both are the same mistake: a policy file naming a channel that only exists if
somebody configured something.

## Mechanical steps (covered by `standards apply`)

No new files. Two seeded references change their content, which `apply` writes
only into repositories that do not have the file yet:

- `reference/common/code-of-conduct.md` — the **Reporting** section now names
  `security@sebastian-software.de` as the single private route, says why (a
  private inbox at Sebastian Software GmbH, independent of any individual
  maintainer, so it works when the report concerns a maintainer), and says why
  there is no maintainer route (GitHub has no private channel to them).
- `reference/common/github-issue-template-config.yml` — two contact links
  instead of one: the email inbox first, marked as the route that always works,
  and the private advisory second, marked as the route that works once private
  vulnerability reporting is enabled. `blank_issues_enabled: false` stays.

This is the shape sebastian-software/agent-bridge#125 already landed by hand.

## Judgement steps (agent work, common scope)

1. **Replace the Reporting section of an existing `CODE_OF_CONDUCT.md`.**
   Seeded files are never rewritten by `apply`, so every repository that already
   has the file needs this by hand. Replace the section body with the reference
   wording; keep the repository's own Expected/Unacceptable behavior text as it
   is. A file that says "contact the maintainers privately through GitHub"
   without naming an address is the exact defect this version fixes — it must
   name `security@sebastian-software.de`.
2. **Give the issue chooser both routes.** Replace the single security entry in
   `.github/ISSUE_TEMPLATE/config.yml` with the two from the reference, and
   replace the second entry's documentation URL with this repository's own form,
   `https://github.com/sebastian-software/<repo>/security/advisories/new` (the
   judgement step from change 0008, unchanged). Keep repository-specific extra
   links, such as a contributor guide, **below** the two security entries.
3. **Enable private vulnerability reporting.** It is a per-repository GitHub
   setting, off by default, and no CLI in this package can set it:

   ```bash
   gh api -X PUT repos/sebastian-software/<repo>/private-vulnerability-reporting
   ```

   Until it is on, the advisory link 404s and the email route is the only one
   that resolves — which is why the seed lists the email first.

4. **Work through the repositories that already took the seeds.** State on
   2026-09-06, `origin/main` of each:

   | Repository   | `CODE_OF_CONDUCT.md`             | Issue chooser                       | Needs                                               |
   | ------------ | -------------------------------- | ----------------------------------- | --------------------------------------------------- |
   | standards    | version 9 seed                   | advisory only                       | done in this change                                 |
   | agent-bridge | version 9 seed                   | already both routes (#125)          | step 1                                              |
   | ferramenta   | version 9 seed                   | advisory only                       | steps 1 and 2                                       |
   | ferriki      | version 9 seed                   | advisory only                       | steps 1 and 2                                       |
   | palamedes    | version 9 seed                   | advisory only                       | steps 1 and 2                                       |
   | ferrolex     | own text, seed-derived Reporting | advisory plus two extra links       | steps 1 and 2, keep the extra links                 |
   | ferrocat     | own text, no address at all      | advisory only                       | steps 1 and 2                                       |
   | ferralk      | none yet                         | advisory only, blank issues enabled | steps 1 and 2 once its version 9 pull request lands |
   | ferroni      | none yet                         | none yet                            | seeded correctly by `apply`                         |
   | ferromark    | none yet                         | none yet                            | seeded correctly by `apply`                         |
   | dalo         | none yet                         | none yet                            | seeded correctly by `apply`                         |

   The four repositories still at version 6 have their version 9 pull request
   open with the **old** seed text in it. A pull request that has not merged yet
   is cheapest to fix in place; one that merged first takes steps 1 and 2 like
   the others. Verify the state before editing rather than trusting this table.

## Notes

- `SECURITY.md` is deliberately unchanged. It already names both channels and
  describes the advisory route as an action in the Security tab rather than a
  link that can 404, so a reader who finds the tab empty still has the address
  in the same section.
- The email route is a `mailto:` link in the issue chooser. GitHub renders
  contact links verbatim, so the reporter's mail client opens with the right
  address instead of the reporter copying it out of a policy file.
- Nothing here needs the label taxonomy, a workflow, or a CLI change; the two
  reference files and the runbook note are the whole version.
