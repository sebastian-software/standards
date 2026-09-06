# 0009 — Rust scope: toolchain files, CI and publish skeletons, Cargo policy

- **Scopes:** common, rust
- **Standards version:** 9

## Intent

Fill in the `rust` scope, which has been declared but empty since the baseline,
so the eight Rust repositories in the family converge on one toolchain shape
instead of drifting further apart.

## Problem

The 2026-09 audit (sebastian-software/ferramenta#6, inventory in
sebastian-software/standards#17) found eight Rust repositories with eight
different answers:

- Editions 2021 and 2024 mixed; MSRVs from 1.81 to 1.96, one repository with
  none at all, and one restating its MSRV in six places.
- One `rustfmt.toml` in eight repositories, so formatting depended on whichever
  rustfmt the contributor had.
- Clippy gates ranging from `correctness` + `suspicious` only, to `-D warnings`
  across eight feature combinations.
- `deny.toml` in three repositories, `cargo audit` in two, nothing in three.
- `rust-toolchain.toml` in two. Licenses MIT, BSD-2-Clause and
  `MIT OR Apache-2.0`, with `authors` set in exactly one repository and docs.rs
  metadata missing in four.

None of this is a per-repository decision. The parts that genuinely are — a
reviewed cargo-deny exception, a stricter MSRV policy, a feature matrix — stay
with the repository, which is why almost nothing in this scope is managed.

## Mechanical steps (covered by `standards apply`)

New `rust` scope entries, detected by a `Cargo.toml` at the repository root
(package or virtual workspace — `detect` only tests for the file):

- **managed** `reference/rust/rustfmt.toml` → `rustfmt.toml`
  (`edition = "2024"`, `newline_style = "Unix"`, nothing else — the org formats
  with rustfmt defaults).
- **seeded** `reference/rust/rust-toolchain.toml` → `rust-toolchain.toml`
  (channel `stable`, components `clippy` and `rustfmt`).
- **seeded** `reference/rust/deny.toml` → `deny.toml` (permissive allow-list,
  `yanked = "deny"`, unmaintained crates flagged across the whole graph,
  crates.io as the only source).

The `sebastian-software-consumer-agents` section in `AGENTS.md` is re-rendered:
its formatter guardrails were Node-only, and a Rust-only repository received
advice about `oxfmt` and `.prettierignore` that did not apply to it. The block
is still one byte-exact text for every consumer, now split into a scope-agnostic
core plus a Node group and a Rust group.

Not seeded, copied by hand: `reference/rust/ci.yml` and
`reference/rust/publish.yml`, for the same reason the Release Please templates
are not seeded — feature matrices, platform lists and release boundaries are
repository decisions. See [`reference/rust/README.md`](../reference/rust/README.md).

## Judgement steps (agent work, rust scope)

1. **Move to edition 2024.** Set `edition = "2024"` in every crate (or in
   `[workspace.package]` with `edition.workspace = true` in the members). Run
   `cargo fix --edition` where the migration is not trivial and read the diff —
   it is a source change, not a metadata change.
2. **Set the MSRV floor.** `rust-version` must not be older than four stable
   releases behind current stable. Raise it only when a feature needs it, and
   keep a repository's stricter policy (ferralk holds stable-minus-two under
   ADR-0004). Compute current stable from `rustc +stable --version` or the
   `channel-rust-stable.toml` manifest — do not copy a number out of another
   repository.
3. **Collapse restated MSRVs.** `rust-version` in `Cargo.toml` is the decision;
   README badges, justfile recipes, docs pages and CI lanes are derived copies.
   Update every copy in the same change, and prefer reading the value (as the
   MSRV job in the CI skeleton does) over writing it down again.
4. **Keep existing `deny.toml` exceptions.** Where a repository already has a
   `deny.toml`, `standards apply` leaves it alone. Merge the org allow-list into
   it, but do not delete a `[licenses] exceptions` entry or an
   `[advisories] ignore` entry — ferrolex and dalo carry reviewed exceptions
   (`CDLA-Permissive-2.0` for `webpki-roots`, crate-scoped ISC and BSD-3-Clause
   grants) and a bans list that is part of their TLS stack decision. Add a
   comment where one is missing instead.
5. **Do not narrow `rustfmt.toml`.** It is managed. A repository that wants a
   different formatting rule brings it to the standards, not to its own copy.
6. **Adopt `MIT OR Apache-2.0`.** Add `LICENSE-MIT` and `LICENSE-APACHE` with
   holder "Sebastian Software GmbH", remove a single MIT-only `LICENSE`, and set
   `license` and `authors = ["Sebastian Software GmbH"]` in every published
   crate. **Ferroni keeps BSD-2-Clause**, inherited from Oniguruma; the same
   applies to any repository whose history shows external copyright holders
   (`git shortlog -sne`) — report instead of relicensing. An author identity
   belonging to the org's own tooling or agents is not an external holder.
7. **Complete the Cargo metadata.** `homepage`, `documentation`
   (`https://docs.rs/<crate>`), `keywords`, `repository`, a
   `[package.metadata.docs.rs]` block with `all-features = true` and
   `rustdoc-args = ["--cfg", "docsrs"]`, and `publish = false` on crates that
   are not for crates.io. Only set `all-features = true` where every feature
   builds on docs.rs.
8. **Inherit the lints table.** `[workspace.lints]` with `[lints] workspace =
true` in each member. A lints table that is defined but never inherited
   (palamedes at audit time) is dead configuration and reads as a gate that
   does not exist.
9. **Merge the CI skeleton.** Take fmt, Clippy `--all-targets --all-features -D
warnings`, the three-OS test matrix, the MSRV lane, rustdoc with
   `RUSTDOCFLAGS=-D warnings`, cargo-deny, the conventional-commit title check
   and the `standards check` lane from `reference/rust/ci.yml`. Every lane runs
   `--locked`, so commit a root `Cargo.lock` first if it is missing. Keep the
   repository's richer jobs (fuzzing, coverage, benchmarks, semver checks)
   untouched. Pin every action to a full commit SHA with a version comment and
   every `docker://` reference to an `@sha256:` digest. A copied pin-check
   script (ferromark's `scripts/check-workflow-pins.rb` exempts `docker://`
   references outright) has to require the digest instead.
10. **Take the publish skeleton only where it fits.** `reference/rust/publish.yml`
    assumes the one-product Release Please shape. Read
    [`reference/release-please/README.md`](../reference/release-please/README.md)
    before adopting it, and report instead of restructuring a workspace that
    would need a new root package. Trusted Publishing has to be enabled per
    crate on crates.io; until then the `CARGO_REGISTRY_TOKEN` fallback carries
    the publish. Keep the manual path tag-bound: `workflow_dispatch` takes a
    required release `tag` and checks that tag out, so a retry can never
    publish newer sources from `main` under an existing version.

## Notes

- Almost nothing here is managed on purpose. `rustfmt.toml` is the only
  byte-exact file, because formatter options are the one thing that must not
  differ between two checkouts of the same repository. The formatter itself
  still comes from the toolchain — stable, or the repository's pin — so rustfmt
  output can shift between stable releases; pin the toolchain if that matters.
- There is no `clippy.toml`. It configures lint knobs, not lint levels, and the
  org has no knob it wants everywhere; Clippy reads the MSRV from
  `rust-version` on its own, so putting it there would only create a second copy.
- `deny.toml` was validated against cargo-deny 0.20 with a real dependency
  graph. `unmaintained = "all"` needs cargo-deny 0.18 or newer; a repository
  pinning an older cargo-deny should drop that line rather than pin an old
  allow-list.
- A Rust word list for `cspell` is deliberately out of scope here; it is tracked
  as sebastian-software/ferramenta#18.
