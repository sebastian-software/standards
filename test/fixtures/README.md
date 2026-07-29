# Consumer fixtures

`github-consumer` is the versioned in-repository replacement for the former
`sebastian-software/standards-test-repo2` repository. It represents a private
Node consumer at standards version 0 on GitHub.

The end-to-end test copies the fixture into a temporary directory and verifies:

- migration to the current standards stamp
- GitHub-specific workflow selection
- managed, seeded, and section-based files
- preservation of consumer-owned package and Renovate configuration
- a clean `standards check` result and idempotent re-application

The fixture intentionally does not attempt to cover GitHub repository settings,
actual Actions execution, Renovate scheduling, or cross-repository pull request
behavior.
