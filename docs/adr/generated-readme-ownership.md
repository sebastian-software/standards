# Generated README ownership

## Status

Active. Update this decision when the ownership contract changes.

## Decision

A repository can delegate its entire README to native mdtheme with
`readme.owner: "mdtheme"` in `.repometa.json`. Standards validates regular
source, output, and YAML config files, the generated-file notice, and the
absence of its old branding markers before writing any managed files.
It then leaves the README untouched. No Node tooling is required in a Rust
consumer. The existing `markdown-themer` owner remains supported for legacy
JavaScript consumers with their existing wiring checks.

Standards never executes theme configuration or installs the generator.
The consumer pins its CLI and runs the generator's check in CI. This keeps
static ownership validation separate from rendering and config semantics.

For Ferramenta projects, native theme order is Sebastian Software, Ferramenta,
then project content. Footers close in reverse order. Shared frames are
maintained in their theme repositories; project prose stays in README.md.src.

## Consequences

Consumers must migrate old branding sections before enabling ownership and
use a standards release that understands their declared owner. An older
checker cannot safely manage a native generated README. Missing or ambiguous
prerequisites fail apply before any writes, rather than silently opting out.

## Repository adoption

Updated: 2026-09-14

This repository uses native mdtheme to compose its committed root README from
`README.md.src` and Sebastian-Theme. The project introduction and setup come
first; the company badge joins the project badges and the logo stays in the
footer. Existing project badge links remain authored content.

The CLI and theme are independently pinned by the project. CI checks generated
output without writing it. Contributors regenerate and commit the output;
pre-push validation never stages or commits. This avoids copied branding and
keeps consumers independent of Node tooling solely for README generation.
The tradeoff is a contributor tool installation and Git access during checks.

This is a living decision. Update this record when the ownership or composition
contract changes; configuration files own exact versions and revisions.
See [the contributor workflow](../readme-theme.md).
