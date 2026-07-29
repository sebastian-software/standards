# One product release with Release Please

Use this pattern when a repository ships several artifacts that intentionally
share one public version. The artifacts may be Rust crates, npm packages, or a
combination of both. Release Please still sees one product component, so each
version gets one release PR, one tag, one changelog, and one GitHub Release.

This is a release-boundary decision, not a publishing shortcut. Packages keep
their own names, registry permissions, build steps, and dependency-aware
publish order. These files are optional reference templates; `standards apply`
does not seed them because it cannot decide whether a repository is one product
or a collection of independently versioned packages.

## Choose the repository shape

| Repository                        | Release authority                                    | Start with                                                                       |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Rust workspace                    | A real Cargo package at the repository root          | [`rust-product-release-config.json`](rust-product-release-config.json)           |
| Node workspace                    | The root `package.json`                              | [`node-product-release-config.json`](node-product-release-config.json)           |
| Rust workspace plus Node packages | The real root Cargo package; Node versions follow it | [`rust-node-product-release-config.json`](rust-node-product-release-config.json) |

Copy the selected file to `release-please-config.json`, then replace
`my-product` and every example path.

The root path `.` is deliberate. Release Please considers releasable commits
across the repository and writes one root entry to
`.release-please-manifest.json`:

```json
{
  ".": "2.2.0"
}
```

Use separate components when packages can release independently, need separate
changelogs, or make different compatibility promises. The `linked-versions`
plugin can align component versions, but those components still keep separate
release records and tags.

## Rust: make the root a real package

The Rust strategy updates every member listed by the root workspace, their
explicit path dependency requirements, and `Cargo.lock`. Its root
`Cargo.toml` updater still requires a concrete `[package]`, so a virtual
workspace containing only `[workspace]` is not sufficient for this pattern.

Make the public umbrella crate, CLI, or another genuine product package the
root package. Its source can stay in a nested directory:

```toml
[package]
name = "my-product"
version = "2.2.0"
edition = "2024"

[lib]
path = "crates/my-product/src/lib.rs"

[workspace]
members = [
  "crates/my-product-core",
  "crates/my-product-cli",
]
```

Every workspace member also needs a concrete version:

```toml
[package]
name = "my-product-core"
version = "2.2.0"
```

List workspace members as explicit paths. The one-component Rust strategy reads
each declared member path directly and does not expand Cargo member globs such
as `crates/*`.

Published internal dependencies need both `version` and `path` where they are
consumed:

```toml
[dependencies]
my-product-core = { version = "2.2.0", path = "crates/my-product-core" }
```

Release Please deliberately skips path dependencies without an explicit
version. It also cannot replace an inherited `version.workspace = true` with a
package version. Workspace inheritance remains useful for edition, license,
repository, lints, and external dependencies; avoid it specifically for
package versions and published internal version requirements. Put those
requirements in the consuming package rather than inheriting them from
`[workspace.dependencies]`.

Moving a package to the repository root can broaden the files Cargo includes.
Add a narrow Cargo `include` list where needed and compare
`cargo package --list` before and after the move.

Do not add `version.txt`, Cargo version `extra-files`, or a workflow step that
regenerates `Cargo.lock` after Release Please. If the native release candidate
does not contain all required Cargo changes, the repository shape is not ready
for this pattern.

## Node: use the root package as the product version

For a Node-only repository, the root `package.json` is the product version
source and the component uses `release-type: node`. Release Please updates that
root metadata through its native Node strategy.

Additional packages that always ship with the product can be typed JSON
`extra-files` instead of separate components:

```json
{
  "type": "json",
  "path": "packages/my-product-cli/package.json",
  "jsonpath": "$.version"
}
```

Prefer workspace-protocol dependencies such as `workspace:*` between local
packages when the package manager's pack and publish behavior fits the
repository. Typed version fields do not maintain an arbitrary dependency
graph. If local packages use explicit SemVer ranges, either enumerate and prove
every required field or configure normal Node components with the
`node-workspace` plugin and accept separate component release records.

Lockfiles are package-manager-specific. On the generated candidate, run the
normal lockfile-only install and require a clean diff, for example:

```sh
pnpm install --lockfile-only
git diff --exit-code
```

Use the equivalent `npm install --package-lock-only` or Yarn command where
appropriate. A dirty lockfile means the template is incomplete for that
repository.

## Rust and Node: let Rust own the release

A configured package has one Release Please strategy, not both Rust and Node.
For a combined repository, use the native Rust root because it owns Cargo
workspace version propagation and `Cargo.lock`. Add the Node package versions
as typed JSON `extra-files` on that component.

Use workspace-protocol references on the Node side where possible, and run both
the Cargo locked checks and the Node lockfile no-diff check on the generated
candidate. If the Node side needs `node-workspace` graph updates, the
one-component mixed pattern is not safe without repository-owned automation.

## Bootstrap an existing repository

The templates intentionally contain no history override. Release Please
distinguishes initial setup from recovery after a bad release PR:

1. Create `.release-please-manifest.json` with the current product version at
   `"."`.
2. Add a top-level `bootstrap-sha` containing the full commit SHA immediately
   before the first commit that the next changelog should include. The commit
   tagged for the current product release is normally the right boundary.
3. Remove `bootstrap-sha` after the first generated release PR has been merged.
   Release Please ignores it after that point, but removing it keeps the config
   honest.

```json
{
  "bootstrap-sha": "<full-commit-sha>",
  "release-type": "rust",
  "packages": {
    ".": {
      "component": "my-product"
    }
  }
}
```

Reserve `last-release-sha` for recovery when a previously merged Release Please
PR must not be treated as the latest release marker. Unlike `bootstrap-sha`, it
is a persistent override and must be removed or changed after recovery.

New repositories can start with an empty manifest (`{}`) and no
`bootstrap-sha`, accepting the strategy's initial version, or set the desired
starting version explicitly in the root manifest entry.

## Publish from one release signal

Run Release Please once and make every publisher depend on the plural
`releases_created` output:

```yaml
jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      releases_created: ${{ steps.release.outputs.releases_created }}
    steps:
      - id: release
        uses: googleapis/release-please-action@v5
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish-rust:
    needs: release-please
    if: ${{ needs.release-please.outputs.releases_created == 'true' }}
    # Publish crates in dependency order.

  publish-npm:
    needs: release-please
    if: ${{ needs.release-please.outputs.releases_created == 'true' }}
    # Build and publish npm packages.
```

Keep platform builds, dependency-aware crate ordering, and Trusted Publishing
in their existing jobs. If CI must run on release PRs, authenticate Release
Please with a suitable GitHub App or personal access token: events created by
the repository's built-in `GITHUB_TOKEN` do not trigger new workflow runs.

## Prove the candidate without publishing

1. Adapt one template and initialise the manifest and optional
   `bootstrap-sha`.
2. Push the configuration to an isolated target branch. Leave every publish
   job disabled for that branch.
3. Run Release Please against that branch and confirm it opens exactly one
   release PR.
4. Inspect the entire candidate diff: every package version, published
   internal requirement, lockfile, manifest entry, and product changelog.
5. Run normal CI, `cargo package --list` where relevant, and all lockfile
   no-diff checks.
6. Close the test PR and delete its generated branch. Move the validated
   configuration through a normal reviewed PR.

Do not merge a disposable release PR merely to create and delete a test tag.
The candidate diff and CI prove the versioning path without adding release
history.

Keep publishing disabled if any of these are true:

- Release Please creates more than one candidate or manifest entry.
- A package version, internal requirement, or lockfile stays stale.
- Regenerating a lockfile changes the candidate.
- Moving the Cargo package to the root changes its published file set
  unexpectedly.
- The Node dependency graph needs updates the selected template does not
  represent.

Fix the repository shape or use ordinary multi-component workspace releases.
Do not patch generated release branches with version-sync cleanup scripts.

## Upstream references

- [Manifest-driven Release Please](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [Release Please extra-file updaters](https://github.com/googleapis/release-please/blob/main/docs/customizing.md#updating-arbitrary-files)
- [Release Please Action inputs and outputs](https://github.com/googleapis/release-please-action)
