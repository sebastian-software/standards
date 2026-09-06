# Shared composite actions

Four composite actions that the org's release workflows have otherwise been
copying between repositories: four hand-written crates.io retry loops, three
napi platform matrices, and one action-pin checker that only two repositories
had. They are ordinary actions in this repository, so consumers reference them
by path and commit SHA:

```yaml
- uses: sebastian-software/standards/.github/actions/publish-crates@<sha> # v0.9.0
```

Resolve the SHA from the release tag, so the pin names a reviewed state and not
whatever `main` is today:

```sh
git ls-remote https://github.com/sebastian-software/standards \
  'refs/tags/standards-v0.9.0^{}'
```

Renovate moves the pin like any other action pin — a tag is not a pin, and
`@main` is not a pin either. The publish workflow that wires the first three
together is [`reference/release-please/publish-skeleton.yml`](../../reference/release-please/publish-skeleton.yml);
the release-boundary decision behind it is in
[`reference/release-please/README.md`](../../reference/release-please/README.md).

## `publish-crates`

Publishes a workspace's crates to crates.io in dependency order.

| Input               | Default | Meaning                                                               |
| ------------------- | ------- | --------------------------------------------------------------------- |
| `crates`            | —       | Ordered crate list, leaves first. Newline- or space-separated         |
| `token`             | `""`    | Fallback crates.io token; empty means Trusted Publishing              |
| `retry-delay`       | `30`    | Seconds before the single retry of a failed publish                   |
| `index-timeout`     | `300`   | Seconds to wait for a published version to appear in the sparse index |
| `working-directory` | `.`     | Where the cargo commands run                                          |

The job needs `permissions: id-token: write` for the OIDC exchange
(`rust-lang/crates-io-auth-action`). Trusted Publishing has to be enabled **per
crate** on crates.io and cannot cover a first-ever publish, because the crate
does not exist yet; pass `token: ${{ secrets.CARGO_REGISTRY_TOKEN }}` until it
is enabled, then delete the input. The choice is explicit rather than a
`continue-on-error` fallback, so a run cannot silently fall back to a
long-lived secret that was supposed to be gone.

Three properties make a re-run safe:

- A crate whose version is already in the sparse index is skipped, so a partial
  publish can be re-run without `crate already exists` errors.
- A failed `cargo publish` is retried once after `retry-delay`, which is what
  index propagation of the previous crate needs.
- After each publish the action waits for the version to appear in the index
  before starting the next crate, so the dependent crate resolves.

## `publish-npm`

Publishes one or more packages with provenance, in the given order.

| Input               | Default  | Meaning                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| `packages`          | `.`      | Ordered package directories, sidecars before the main package |
| `dist-tag`          | `""`     | Empty derives it from the version                             |
| `access`            | `public` | npm access level for a first publish                          |
| `provenance`        | `true`   | Attach a provenance attestation                               |
| `token`             | `""`     | Fallback npm token; empty means Trusted Publishing            |
| `working-directory` | `.`      | Where the npm commands run                                    |

Output `dist-tag` carries what was used.

The dist-tag is derived from the version of the **last** package in the list —
the main package: `1.2.3` publishes to `latest`, `1.2.3-rc.1` to `rc`,
`1.2.3-next.4` to `next`, and a numeric prerelease (`1.2.3-1`) to `next`. A
release candidate therefore never lands on `latest` by omission.

The job needs `permissions: id-token: write` for provenance and for Trusted
Publishing, and npm 11.5.1 or newer — `npm install --global npm@latest` after
`actions/setup-node`. Publishing runs through `npm publish` even in pnpm
repositories, because pnpm does not implement npm's Trusted Publishing exchange.

## `napi-matrix`

Emits the org-wide `@napi-rs/cli` 3 platform list as a job matrix, so a
repository declares its platforms in one place instead of in a workflow, a
build script and eight sidecar manifests.

| Input       | Default | Meaning                                   |
| ----------- | ------- | ----------------------------------------- |
| `package`   | —       | The main npm package name, scope included |
| `platforms` | `""`    | Platform ids to include; empty means all  |
| `exclude`   | `""`    | Platform ids to drop                      |

Outputs: `matrix` (JSON with an `include` array, for
`strategy: matrix: ${{ fromJSON(...) }}`), `platform-ids` (space-separated, for
shell loops) and `sidecars` (JSON array of sidecar package names).

| Platform id        | Rust target                  | Runner             | os     | cpu   | libc  |
| ------------------ | ---------------------------- | ------------------ | ------ | ----- | ----- |
| `linux-x64-gnu`    | `x86_64-unknown-linux-gnu`   | `ubuntu-latest`    | linux  | x64   | glibc |
| `linux-arm64-gnu`  | `aarch64-unknown-linux-gnu`  | `ubuntu-24.04-arm` | linux  | arm64 | glibc |
| `linux-x64-musl`   | `x86_64-unknown-linux-musl`  | `ubuntu-latest`    | linux  | x64   | musl  |
| `linux-arm64-musl` | `aarch64-unknown-linux-musl` | `ubuntu-latest`    | linux  | arm64 | musl  |
| `darwin-arm64`     | `aarch64-apple-darwin`       | `macos-latest`     | darwin | arm64 | —     |
| `darwin-x64`       | `x86_64-apple-darwin`        | `macos-15-intel`   | darwin | x64   | —     |
| `win32-x64-msvc`   | `x86_64-pc-windows-msvc`     | `windows-latest`   | win32  | x64   | —     |
| `win32-arm64-msvc` | `aarch64-pc-windows-msvc`    | `windows-11-arm`   | win32  | arm64 | —     |

The two musl entries carry `native: false`: their runner is not a musl host, so
the job installs the musl toolchain and cross-compiles. Everything else builds
natively on the listed runner.

Naming is derived, never written down twice (decision D7 of the family audit):

- sidecar package — `<package>-<id>`, which keeps a scoped package's sidecars
  in its own scope (`@acme/tool` → `@acme/tool-darwin-arm64`);
- addon file — `<binary>.<id>.node`, the `@napi-rs/cli` default, where
  `<binary>` is the package name without its scope;
- CI artifact — `native-<id>`.

## `check-action-pins`

Fails when a `uses:` names anything but a full 40-character commit SHA with the
version in a trailing comment.

| Input   | Default             | Meaning                                                   |
| ------- | ------------------- | --------------------------------------------------------- |
| `paths` | `.github/workflows` | Files and directories to scan; directories recursively    |
| `allow` | `""`                | Newline-separated `uses` values that are exempt, verbatim |

```yaml
- uses: sebastian-software/standards/.github/actions/check-action-pins@<sha> # v0.9.0
  with:
    paths: |
      .github/workflows
      .github/actions
```

A moved tag changes what CI executes with the job's token, which is why the
rule is a SHA and not a tag. Two consequences the generalized version keeps:

- a `docker://` reference must name an immutable `@sha256:` digest — an image
  tag moves exactly like a git tag, so exempting it is a hole;
- the version comment is required, because a bare SHA is unreviewable.

Local `./…` references are exempt: they are part of the checkout. The scan is
line-based, so it needs no dependency install in the job, and it recognizes the
block (`- uses: x`), flow (`- { uses: x }`) and quoted (`"uses": x`) forms; a
`uses` key in a shape it cannot classify is reported rather than skipped. Use
`allow` for a reference that genuinely cannot be a SHA, and review the entry.
