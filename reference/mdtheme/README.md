# Native README composition

Use mdtheme 0.4.0 or newer for theme badges. The CLI belongs to each project;
standards does not bundle it or upgrade existing pins during `apply`.

1. Follow the [project tool setup](https://github.com/sebastian-software/mdtheme/blob/main/docs/project-tools.md).
   Commit an exact version in `mise.toml` and the generated five-platform
   `mise.lock`. Run `mise install --locked` explicitly during setup and CI.
2. Keep authored content in `README.md.src` and select themes in `mdtheme.yaml`.
   Set `readme.owner` to `mdtheme` in `.repometa.json`. Native ownership does not
   require a package manifest, npm script, or TypeScript configuration.
3. Run `mise run readme:write`, review the generated README, and commit it with
   its source. Run `mise run readme:check` in CI and `mise run readme:pre-push`
   before pushing. Tasks resolve the project pin and disable automatic
   installation and system fallback.

## Shared badges

Sebastian's native theme supplies `badges-prepend.md` and `footer.md`. Keep it
first in `themes`. A Ferramenta family theme can follow it unchanged, so the
company frame stays outside the family frame.

Wrap the existing project badge row in `README.md.src` with:

```markdown
<!-- mdtheme:badges:start -->

[![Build](https://example.com/build.svg)](https://example.com/build)

<!-- mdtheme:badges:end -->
```

Use one ordered pair only. An empty pair works with generated metadata badges.
Without a pair, generated badges appear before the source. Remove manually
copied company badges; the renderer does not deduplicate them. Markdown badges
should sit outside raw HTML blocks. See the
[theme guide](https://github.com/sebastian-software/mdtheme/blob/main/docs/theme-authoring.md)
for nesting and HTML details.

Upgrade and lock the CLI before adopting a theme revision that uses badge
fragments. Keep old projects on an earlier theme commit until migrated. CI must
check the generated output using the project's installed CLI; `standards check`
only validates static README ownership and does not execute themes or mdtheme.

These instructions are an opt-in reference. Existing pins, unrelated mise tools,
source text, and theme selections remain project-owned.
