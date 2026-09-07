# Effective Flow project setup

## Status

Active

## Context

This ADR holds this project's tracked Effective Flow configuration. `.effective-flow/` is a pure
runtime directory and completely gitignored.

Three values are pinned deliberately rather than left at their defaults, and the reasons are worth
keeping next to them.

`tracker.mode` is `remote`. This repository's work already lives in GitHub issues behind the
`origin` remote, so planning, issue-driven implementation and review all resolve the forge. Leaving
the default `local` would make every tracker-bound run ask, or write Markdown reports under
`.effective-flow/review/` that nobody reads.

`mergeGate.completion` is `merge`. A merge-gate run is started by a person invoking it, so the
authorization is already explicit at that point; asking again once per run adds a step without
adding a decision. Branch protection on `main` (`enforce_admins: true`, required check `check`)
stays the independent gate, and `SKILL.md` continues to require a human merge for the
standards-drift pull requests the agent pipeline opens in consumer repositories — that policy is
about those repositories, not about this one's own gate runs.

`mergeGate.bots` is deliberately **not** set, even though Greptile reviews every pull request here.
Greptile publishes its `Greptile Review` check run only for a pull request's **first** head; a
follow-up commit gets no new check run, and the tool offers a re-trigger URL rather than a comment
command the gate could post. Configuring it would therefore leave merge precondition 5 ("every
configured reviewer has run for the current head") unmet after any follow-up commit — a ten-minute
wait followed by a blocked merge, with no way for the gate to recover. Greptile stays an advisory
candidate: its review threads are still read, handed to `effective-flow iterate`, answered and
resolved, but the gate does not formally wait for it. Revisit this if Greptile gains per-head
re-review or a comment trigger.

`delivery.mergeMethod` is `squash` because the repository permits no other method.

## Configuration

| Key                               | Value                      |
| --------------------------------- | -------------------------- |
| review.profile                    | focused                    |
| review.autoConfirmScope           | false                      |
| review.designDecisionSources      | standard                   |
| review.validation                 | full                       |
| applyReview.defaultCommitStrategy | null                       |
| applyReview.finalValidation       | full                       |
| applyReview.stashPolicy           | interactive                |
| applyReview.worktree.baseDir      | .effective-flow/.worktrees |
| applyReview.worktree.setup        | auto                       |
| worktree.enabled                  | true                       |
| delivery.baseBranch               | origin/main                |
| delivery.completion               | merge                      |
| delivery.mergeMethod              | squash                     |
| mergeGate.completion              | merge                      |
| tracker.mode                      | remote                     |
| plan.dir                          | docs/plan                  |
| language.project                  | en                         |
