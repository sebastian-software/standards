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
