# Rust scope

The `rust` scope applies to every repository with a `Cargo.toml` at its root —
a package or a virtual workspace, it makes no difference to detection.

## Files

| File                  | Kind          | Why                                                                                   |
| --------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `rustfmt.toml`        | **managed**   | Formatter options must be identical everywhere; the formatter itself is not pinned    |
| `rust-toolchain.toml` | **seeded**    | Repositories that pin their MSRV here instead of tracking stable keep their own       |
| `deny.toml`           | **seeded**    | The allow-list is org-wide, but reviewed per-crate exceptions are repository property |
| `ci.yml`              | **reference** | Feature matrices, platforms and extra gates differ too much to seed byte-exact        |

Managed files are rewritten by `standards apply`; seeded files are created once
and then belong to the repository; reference files are copied by hand.

There is no `publish.yml` here any more. It grew npm and native-artifact jobs
and moved next to the release templates that decide the release boundary:
[`../release-please/publish-skeleton.yml`](../release-please/publish-skeleton.yml).

`rustfmt.toml` fixes the options, not the formatter. CI checks formatting with
the rustfmt of the repository's toolchain — current stable unless
`rust-toolchain.toml` pins a version — and rustfmt defaults can shift between
stable releases while `standards check` stays green. A repository that needs
byte-stable output across releases pins its toolchain; the org does not pin one
everywhere, because tracking stable is what the seeded file is for.

There is deliberately **no `clippy.toml`**. That file configures lint knobs
(thresholds, `msrv`, disallowed types), not lint levels, and the org has no
knob it wants everywhere. Lint levels belong in `[workspace.lints]`, and Clippy
already reads the MSRV from `rust-version` in `Cargo.toml` — restating it in
`clippy.toml` would create a second copy that goes stale.

## Edition and MSRV

- **Edition 2024** in every crate.
- **The MSRV is raised only when a feature needs it**, and it must never be
  older than four stable releases behind current stable. Rust ships every six
  weeks, so the floor moves roughly every six months. Compute it from the
  current stable version rather than from a number written down somewhere:
  `rustc +stable --version`, or the `pkg.rust` version in
  `https://static.rust-lang.org/dist/channel-rust-stable.toml`.
- A repository may be **stricter** than the floor. Ferralk holds
  stable-minus-two under its ADR-0004 and keeps a scheduled policy job that
  fails when the declared MSRV drifts from that rule.
- `rust-version` in `Cargo.toml` is the **only** place the MSRV is decided.
  Every other mention — README badge, justfile, docs page, CI lane — is derived
  from it. The MSRV job in `ci.yml` reads it with `cargo metadata` for exactly
  that reason; that also resolves `rust-version.workspace = true` and fails when
  workspace members disagree.

## License

All Rust crates are `MIT OR Apache-2.0`, with `LICENSE-MIT` and
`LICENSE-APACHE` checked in, the holder written as **Sebastian Software GmbH**,
and:

```toml
license = "MIT OR Apache-2.0"
authors = ["Sebastian Software GmbH"]
```

**Ferroni is the documented exception**: it is a port of Oniguruma and stays
BSD-2-Clause, inherited from the original. Do not "align" it. Any other
repository whose history shows external copyright holders is a question for a
human, not a rename.

## Cargo metadata

Every published crate carries:

```toml
homepage = "https://…"                     # docs site if there is one, else the repository
documentation = "https://docs.rs/<crate>"
keywords = ["…"]                           # family crates include a family keyword
repository = "https://github.com/sebastian-software/<repo>"

[package.metadata.docs.rs]
all-features = true
rustdoc-args = ["--cfg", "docsrs"]

[lints]
workspace = true
```

- `all-features = true` only where all features actually build on docs.rs.
  Exclude features that need an external toolchain.
- `[workspace.lints]` holds the shared lint levels (`unsafe_code = "deny"` is
  the common shape); crates inherit them with `[lints] workspace = true`.
  A lints table that is defined but never inherited is dead configuration.
- Crates that are not meant for crates.io set `publish = false`.

## Dependency policy

`deny.toml` allows MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC,
Unicode-3.0 and Zlib, denies yanked crates, flags unmaintained crates across
the whole graph, and restricts sources to crates.io.

Widen it with a **narrow, reviewed exception** — a `[licenses] exceptions`
entry scoped to one crate, or an `[advisories] ignore` entry with a comment
naming the advisory and the reason. Never widen the `allow` list itself, and
never delete an exception another repository reviewed.

## CI and publishing

`ci.yml` covers fmt, Clippy with `--all-targets --all-features -D warnings`,
tests on Linux, macOS and Windows, the MSRV lane, rustdoc with
`RUSTDOCFLAGS=-D warnings`, cargo-deny, a conventional-commit title check, and
the `standards check` drift lane with its `.standards/pending.json` guard.

That drift lane runs a **pinned** CLI: `dlx @sebastian-software/standards@<x.y.z>`.
A Rust-only repository has no lockfile to hold the version, so the pin lives in
the workflow and Renovate keeps it current. Add this custom manager to the
repository's `renovate.json` — or take it from the org preset once it moves
there:

```json
{
  "customManagers": [
    {
      "customType": "regex",
      "description": "Keep the pinned standards CLI in the workflows current",
      "managerFilePatterns": ["/^\\.github/workflows/.+\\.ya?ml$/"],
      "matchStrings": ["@sebastian-software/standards@(?<currentValue>[^\\s]+) "],
      "depNameTemplate": "@sebastian-software/standards",
      "datasourceTemplate": "npm"
    }
  ]
}
```

`managerFilePatterns` replaced `fileMatch` in Renovate 41; on an older worker
the key is `fileMatch` with the same value. Raise the pin in the same pull
request that runs `apply`, so the stamp and the CLI that checks it never
disagree — a CLI older than the stamp reports drift that does not exist.

The version in this reference `ci.yml` is not hand-edited: release-please
bumps it in the standards repository alongside `package.json`, so every
published copy names the CLI that matches the stamp it ships.

A committed root `Cargo.lock` is a prerequisite of the standard, libraries
included: every cargo command in `ci.yml` runs with `--locked`, so dependency
drift fails the build instead of resolving silently. Every family repository
already commits one; a repository that does not must add it before copying the
workflow.

Publishing is no longer a Rust-scope file. The former `publish.yml` grew npm
and native-artifact jobs and moved to
[`../release-please/publish-skeleton.yml`](../release-please/publish-skeleton.yml),
next to the release templates that decide the release boundary: one release job
whose `releases_created` output gates the publish jobs. crates.io publishing
runs through the shared
[`publish-crates`](../../.github/actions/README.md#publish-crates) composite
action, which uses `rust-lang/crates-io-auth-action` and takes an optional
`secrets.CARGO_REGISTRY_TOKEN` because Trusted Publishing has to be enabled per
crate and may not be configured yet. The `workflow_dispatch` path is for
retries: it takes a required release `tag` and checks that tag out, never
`main`, so a delayed retry publishes the sources the release was cut from and
not whatever `main` has become since.

Actions are pinned to full commit SHAs with the version in a trailing comment.
A `docker://` reference is pinned to an immutable `@sha256:` digest — an image
tag can be moved just like a git tag, so a repository that carries a
pin-check script must hold `docker://` uses to the digest rule instead of
exempting them. Renovate updates both kinds of pin; a tag is not a pin. The
[`check-action-pins`](../../.github/actions/README.md#check-action-pins)
composite action enforces exactly that rule and replaces the per-repository
copies of the script.

## Generated READMEs

See the [native mdtheme reference](../mdtheme/README.md) for project-owned CLI
pins, CI checks, and shared badge placement. No Node manifest is needed.
