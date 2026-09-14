# Set up repository labels

Run these commands from a checkout of `standards`, against the intended
consumer repository. Set `TARGET_REPO` to its owner/name explicitly. Label setup requires
repository write access. The CLI does not create labels.

One issue taxonomy for the whole org, shipped as data in
[`../reference/common/labels.json`](../reference/common/labels.json):

| Group         | Labels                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| **type**      | `type:bug`, `type:feature`, `type:docs`, `type:chore`                           |
| **priority**  | `priority:P0` (drop everything) … `priority:P3` (backlog)                       |
| **area**      | `area:<subsystem>` — the prefix is org-wide, the values are per repo            |
| **workflow**  | `epic`, `cross-repo`, `good first issue`, `dependencies`, `question`            |
| **standards** | `standards:needs-agent`, `standards:needs-review` (see [SKILL.md](../SKILL.md)) |

Issues labeled `epic` use the title convention `Epic: …`. The seeded issue forms
apply `type:bug`, `type:feature` and `question` automatically.

The CLI does not manage labels — applying them is a one-shot `gh` call per repo:

```bash
# Choose the consumer, not the standards source repository.
TARGET_REPO="sebastian-software/<repo>"

# Create or update every label from the taxonomy.
jq -r '.labels[] | [.name, .color, .description] | @tsv' reference/common/labels.json |
  while IFS=$'\t' read -r name color description; do
    gh label create "$name" --repo "$TARGET_REPO" --color "$color" --description "$description" --force
  done
```

Rename the existing per-repo spellings instead of recreating them, so open
issues keep their labels:

```bash
gh label edit "priority:low" --repo "$TARGET_REPO" --name "priority:P3"
```

| Existing label                          | Taxonomy                                  |
| --------------------------------------- | ----------------------------------------- |
| `priority:P0` (ferriki)                 | unchanged                                 |
| `priority:low` (ferrolex)               | `priority:P3`                             |
| `priority: P2` (dalo, with space)       | `priority:P2`                             |
| `P3` (palamedes)                        | `priority:P3`                             |
| `category:<x>`                          | `area:<x>`                                |
| `bug` / `enhancement` / `documentation` | `type:bug` / `type:feature` / `type:docs` |

The full mapping is the `migrations` array in `labels.json`.
