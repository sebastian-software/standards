# Changelog

## [0.11.1](https://github.com/sebastian-software/standards/compare/standards-v0.11.0...standards-v0.11.1) (2026-09-11)


### Bug Fixes

* **docs:** document native mdtheme badge integration ([#83](https://github.com/sebastian-software/standards/issues/83)) ([8c76402](https://github.com/sebastian-software/standards/commit/8c764026ede286937b86a826c8d08451a2187fc7))

## [0.11.0](https://github.com/sebastian-software/standards/compare/standards-v0.10.0...standards-v0.11.0) (2026-09-11)


### Features

* delegate generated README ownership to native mdtheme ([#81](https://github.com/sebastian-software/standards/issues/81)) ([0dc064a](https://github.com/sebastian-software/standards/commit/0dc064a35d835e940b9994df51b573ce624b3886))

## [0.10.0](https://github.com/sebastian-software/standards/compare/standards-v0.9.0...standards-v0.10.0) (2026-09-07)


### Features

* **cli:** prove CLI and stamp alignment and mark unvalidated agent runs ([#76](https://github.com/sebastian-software/standards/issues/76)) ([56c1fad](https://github.com/sebastian-software/standards/commit/56c1fade07fb8f7fb12fc2b308e5c9f89ef4fe80))


### Bug Fixes

* **cli:** report the stale-CLI mismatch from apply and sync ([#79](https://github.com/sebastian-software/standards/issues/79)) ([af276c0](https://github.com/sebastian-software/standards/commit/af276c0f3c9c8bf80fcc433f74de4a86e7db64ef))
* **release:** let release-please carry the pinned CLI in the Rust reference ([#80](https://github.com/sebastian-software/standards/issues/80)) ([3dadb81](https://github.com/sebastian-software/standards/commit/3dadb814c8097d86aa6529218e4b3fe86024c83a))

## [0.9.0](https://github.com/sebastian-software/standards/compare/standards-v0.8.0...standards-v0.9.0) (2026-09-06)


### Features

* **ci:** pin the standards CLI that consumer CI executes ([#72](https://github.com/sebastian-software/standards/issues/72)) ([fb503f1](https://github.com/sebastian-software/standards/commit/fb503f1a8c8032aa0529976a44bbaebf4c34e73b))
* **cli:** apply the node scope inside declared workspaces ([#74](https://github.com/sebastian-software/standards/issues/74)) ([50b6ba1](https://github.com/sebastian-software/standards/commit/50b6ba1a1046c45bb0d18a53da4239326ae4921e))
* **release:** add the publish skeleton and shared composite actions ([#69](https://github.com/sebastian-software/standards/issues/69)) ([b8c5862](https://github.com/sebastian-software/standards/commit/b8c58627f5e1333bd2279a91788209f8ff63bdf3))


### Bug Fixes

* **common:** name a private reporting route that resolves ([#70](https://github.com/sebastian-software/standards/issues/70)) ([ef4e5fd](https://github.com/sebastian-software/standards/commit/ef4e5fd081fa68b9233b6fa980d2da7ca5731c40))

## [0.8.0](https://github.com/sebastian-software/standards/compare/standards-v0.7.0...standards-v0.8.0) (2026-09-06)


### Features

* add consumer agent guardrails ([38563cd](https://github.com/sebastian-software/standards/commit/38563cd67a6abcc8506bd2ba73c256bd6b825870))
* add consumer agent guardrails ([b0aa242](https://github.com/sebastian-software/standards/commit/b0aa2425cb9924c0ae1bc5e0a34e3720939c42f7))
* add Release Please product templates ([#62](https://github.com/sebastian-software/standards/issues/62)) ([ac98907](https://github.com/sebastian-software/standards/commit/ac98907f6ea6bdeb958d6a25dcd1432ef60d32e8))
* **common:** seed community files, issue forms, PR template and CLAUDE pointer ([#65](https://github.com/sebastian-software/standards/issues/65)) ([4e4bc3c](https://github.com/sebastian-software/standards/commit/4e4bc3c3e1bfb7188088ef064036cfeb5fda136c))
* **rust:** define the Rust scope with toolchain files, CI and publish skeletons ([#67](https://github.com/sebastian-software/standards/issues/67)) ([9be2b50](https://github.com/sebastian-software/standards/commit/9be2b50ea5c3824e2a49c8a18066e90192338cab))

## [0.7.0](https://github.com/sebastian-software/standards/compare/standards-v0.6.1...standards-v0.7.0) (2026-06-22)


### Features

* **node:** exclude own org packages from pnpm release cooldown ([48e9e24](https://github.com/sebastian-software/standards/commit/48e9e24947e856a7238540e010a6b744a3957f53))
* **node:** exclude own org packages from pnpm release cooldown ([b8d42e5](https://github.com/sebastian-software/standards/commit/b8d42e5d202026ec2ebe806827e7b6e77a537078))


### Bug Fixes

* **node:** move oxfmt ignores into .oxfmtrc.json ignorePatterns ([c28b176](https://github.com/sebastian-software/standards/commit/c28b176480620e66126f9d0a1aa5e4c7d658dbae))
* **node:** move oxfmt ignores into .oxfmtrc.json ignorePatterns ([5aec0d5](https://github.com/sebastian-software/standards/commit/5aec0d5880f91a84ebc02e6a4eec9f6be81b2a31))

## [0.6.1](https://github.com/sebastian-software/standards/compare/standards-v0.6.0...standards-v0.6.1) (2026-06-20)


### Bug Fixes

* bypass pnpm minimumReleaseAge on every standards dlx invocation ([932759c](https://github.com/sebastian-software/standards/commit/932759c355570203cdd3527df8eadeb9141ea57f))
* bypass pnpm minimumReleaseAge on every standards dlx invocation ([a8f986b](https://github.com/sebastian-software/standards/commit/a8f986bb50588e2bbafb1669f4f6c03ad52c1308))

## [0.6.0](https://github.com/sebastian-software/standards/compare/standards-v0.5.0...standards-v0.6.0) (2026-06-19)


### Features

* post failed or incomplete agent checks as a PR information comment ([a67b045](https://github.com/sebastian-software/standards/commit/a67b04554f4e2f63c5798393c4e16361c61a9d0e))
* post failed or incomplete agent checks as a PR information comment ([fe0b95c](https://github.com/sebastian-software/standards/commit/fe0b95c44aff582248b872b0e5454999dd187bf7))

## [0.5.0](https://github.com/sebastian-software/standards/compare/standards-v0.4.0...standards-v0.5.0) (2026-06-19)


### Features

* assertPendingPayload guard plus runInit stdin docs note ([e1da040](https://github.com/sebastian-software/standards/commit/e1da0402a0c4460269907fb810dc88e458aeb41b))
* assertPendingPayload guard plus runInit stdin docs note ([6ee1ff8](https://github.com/sebastian-software/standards/commit/6ee1ff883cda77b444551437c718984bcf67d026))
* Forgejo Actions CI seed (standards v4) ([6f679ce](https://github.com/sebastian-software/standards/commit/6f679ce3db1a0c24dfc999e80a31d4060df74985))
* Forgejo Actions CI seed (standards v4) ([f5423f9](https://github.com/sebastian-software/standards/commit/f5423f959d585823c7cac950fc82ca03b08f9cb6)), closes [#10](https://github.com/sebastian-software/standards/issues/10)
* platform-aware manifest, CLI, and GitHub Actions CI seed (standards v3) ([214ff26](https://github.com/sebastian-software/standards/commit/214ff26769506b988d3dbaa9e20ca6e0c790c97f))
* platform-aware manifest, CLI, and GitHub Actions CI seed (standards v3) ([8d28678](https://github.com/sebastian-software/standards/commit/8d286781c8254baa9d21dcfea41b046d49618c7c)), closes [#9](https://github.com/sebastian-software/standards/issues/9)
* reference pending.json changes from the agent prompt instead of duplicating them ([eb005c5](https://github.com/sebastian-software/standards/commit/eb005c59c4d878842f101c99014a5e957b280ea5))
* reference pending.json changes from the agent prompt instead of duplicating them ([99f0c3d](https://github.com/sebastian-software/standards/commit/99f0c3d4f606183257c2797aecd441748818ba23))
* run standards agent checks in CI mode as non-blocking hints ([9308d94](https://github.com/sebastian-software/standards/commit/9308d94295a4beeea4bee9b19da4bf3b02ed239d))
* run standards agent checks in CI mode as non-blocking hints ([116ca22](https://github.com/sebastian-software/standards/commit/116ca22ca36b0cc3460205c8f7f05fb9b400cd16))


### Bug Fixes

* seed renovate.json with canonical github&gt; preset references ([195d41e](https://github.com/sebastian-software/standards/commit/195d41ecfd3a3e171261e61f6ae4066f8c2c1860))
* seed renovate.json with canonical github&gt; preset references ([ff84f90](https://github.com/sebastian-software/standards/commit/ff84f90363224a5276e139cc2f8680c394d2b34b)), closes [#12](https://github.com/sebastian-software/standards/issues/12)

## [0.4.0](https://github.com/sebastian-software/standards/compare/standards-v0.3.0...standards-v0.4.0) (2026-06-16)


### Features

* standards init command to bootstrap .repometa.json ([124c300](https://github.com/sebastian-software/standards/commit/124c300f3a381adb1aeb7da79b7ed53ab748e7d7))

## [0.3.0](https://github.com/sebastian-software/standards/compare/standards-v0.2.0...standards-v0.3.0) (2026-06-15)


### Features

* --from-version and --emit-pending flags for Renovate-driven sync ([1104582](https://github.com/sebastian-software/standards/commit/11045825f4fd586c4f2bf18bd1088ba2c53e3021))

## [0.2.0](https://github.com/sebastian-software/standards/compare/standards-v0.1.0...standards-v0.2.0) (2026-06-12)


### Features

* CI-based publishing via release-please and npm trusted publishing (OIDC) ([62a14ea](https://github.com/sebastian-software/standards/commit/62a14ea45a564c447eed41ced74150fe4c992795))


### Bug Fixes

* normalize bin path so npm publish keeps the binary, add prepublishOnly build ([c314629](https://github.com/sebastian-software/standards/commit/c314629dd8ba85f2935d80583351ce37d3e79fa6))
* shebang-safe bin wrapper — 0.1.0 binary is broken without it ([1d1c587](https://github.com/sebastian-software/standards/commit/1d1c587a04de5e335c96bd35546ef63c4ff6b75a))
