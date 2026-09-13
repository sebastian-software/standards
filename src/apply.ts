import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ScopeSpec } from "./manifest.js";
import type { IgnoreMigration } from "./oxfmt-ignores.js";
import type { RepoMeta } from "./repo.js";
import type { SyncContext } from "./sync.js";

import { upsertSection } from "./branding.js";
import {
  IGNORE_FILE,
  mergeIgnoreFile,
  OXFMT_CONFIG,
  planIgnoreMigration,
} from "./oxfmt-ignores.js";
import { readmeMigrationIssues } from "./readme.js";
import { isGeneratedReadme, writeRepoMeta } from "./repo.js";
import {
  createContext,
  matchesPlatform,
  readReference,
  readTarget,
  renderSectionBody,
} from "./sync.js";

export type Change = {
  path: string;
  action: "appended" | "bumped" | "created" | "replaced" | "seeded" | "updated";
};

function writeTarget(cwd: string, target: string, content: string): void {
  const path = join(cwd, target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/**
 * Carries the repository's own `ignorePatterns` out of the managed oxfmt config
 * before it is overwritten, so restoring the managed file does not silently
 * re-enable formatting for files the repository had excluded. See
 * `src/oxfmt-ignores.ts` for where the entries go and why.
 */
function preserveOxfmtIgnores(context: SyncContext, migration: IgnoreMigration): Change[] {
  const existing = readTarget(context, IGNORE_FILE);
  const content = mergeIgnoreFile(existing, migration.moved, migration.unmoved);
  if (content === undefined) return [];
  writeTarget(context.cwd, IGNORE_FILE, content);
  return [{ path: IGNORE_FILE, action: existing === undefined ? "created" : "appended" }];
}

/**
 * Every drifting oxfmt config of one run writes the same root `.prettierignore`,
 * so the run reports that file once: at the position of its first record, as
 * `created` when any unit created it and as `appended` otherwise.
 */
function mergeIgnoreFileChanges(changes: Change[]): Change[] {
  const created = changes.some(
    (change) => change.path === IGNORE_FILE && change.action === "created",
  );
  let reported = false;
  return changes.flatMap((change) => {
    if (change.path !== IGNORE_FILE) return [change];
    if (reported) return [];
    reported = true;
    return [{ path: IGNORE_FILE, action: created ? "created" : change.action }];
  });
}

/** Where a unit's entries are written, plus the oxfmt configs that existed before this run. */
type Placement = { dir: string; configDirs: string[] };

function applyManaged(context: SyncContext, scope: ScopeSpec, placement: Placement): Change[] {
  const { dir, configDirs } = placement;
  return scope.managed
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .flatMap((mapping) => {
      const target = join(dir, mapping.target);
      const reference = readReference(context, mapping.source);
      const actual = readTarget(context, target);
      if (actual === reference) {
        return [];
      }
      const preserved =
        mapping.target === OXFMT_CONFIG
          ? preserveOxfmtIgnores(
              context,
              planIgnoreMigration({ actual, reference, dir, configDirs }),
            )
          : [];
      writeTarget(context.cwd, target, reference);
      return [
        ...preserved,
        {
          path: target,
          action: actual === undefined ? ("created" as const) : ("updated" as const),
        },
      ];
    });
}

function applySeeded(context: SyncContext, scope: ScopeSpec, dir: string): Change[] {
  return scope.seeded
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .flatMap((mapping) => {
      const target = join(dir, mapping.target);
      if (readTarget(context, target) !== undefined) {
        return [];
      }
      writeTarget(context.cwd, target, readReference(context, mapping.source));
      return [{ path: target, action: "seeded" as const }];
    });
}

function applySections(context: SyncContext, scope: ScopeSpec): Change[] {
  return scope.sections
    .filter(
      (section) =>
        section.file !== "README.md" ||
        section.marker !== "sebastian-software-branding" ||
        !isGeneratedReadme(context.meta),
    )
    .filter((section) => matchesPlatform(section.platform, context.meta.platform))
    .flatMap((section) => {
      const existing = readTarget(context, section.file) ?? "";
      const result = upsertSection(existing, section.marker, renderSectionBody(context, section));
      if (result.action === "unchanged") {
        return [];
      }
      writeFileSync(join(context.cwd, section.file), result.content, "utf8");
      return [{ path: section.file, action: result.action }];
    });
}

function hasPlatformScopedEntries(scopes: ScopeSpec[]): boolean {
  return scopes.some(
    (scope) =>
      scope.managed.some((entry) => entry.platform !== undefined) ||
      scope.seeded.some((entry) => entry.platform !== undefined) ||
      scope.sections.some((entry) => entry.platform !== undefined),
  );
}

export type ApplyOptions = {
  /**
   * `.repometa.json` the caller has already read. Passing it keeps a single
   * read per command, so `apply` and the pending-marker build see the same
   * meta even though the file is rewritten in between.
   */
  preReadMeta?: RepoMeta;
  /**
   * Whether the caller passed `--from-version` explicitly. It is the reliable
   * discriminator between the two ways `apply` can meet a repository stamped
   * ahead of the running CLI:
   *
   * - Renovate always passes it, and it legitimately raises
   *   `.repometa.json#standards` before the `dlx`-resolved CLI runs. That CLI
   *   may be older than the raised stamp, and self-healing the stamp downwards
   *   is what keeps the migration pull request green.
   * - A human or agent invoking a stale pinned CLI directly passes nothing. The
   *   stamp is then evidence of a real misalignment, and lowering it would
   *   erase exactly the signal `standards check` needs to report.
   *
   * The signal is threaded from `applyCommand` rather than re-derived here:
   * `runApply` sees only the resulting meta, in which both cases look alike.
   */
  explicitFromVersion?: boolean;
};

function validateReadmeMigration(context: SyncContext): void {
  if (!isGeneratedReadme(context.meta)) return;
  const issues = readmeMigrationIssues(context.cwd, context.meta.readme?.owner);
  if (issues.length > 0) {
    throw new Error(
      `Invalid ${context.meta.readme?.owner} README migration:\n${issues.map((issue) => `- ${issue.path}: ${issue.detail}`).join("\n")}`,
    );
  }
}

export function runApply(cwd: string, currentYear: number, options?: ApplyOptions): Change[] {
  const context = createContext(cwd, currentYear, options?.preReadMeta);

  // A CLI older than the repository's stamp is untrusted for the whole run, not
  // just for the stamp: its references are the ones of an earlier standards
  // version, so writing them would downgrade managed content while the stamp
  // still claims the newer version — a worse state than the misalignment it was
  // meant to preserve evidence of. Nothing is written at all; see
  // `ApplyOptions.explicitFromVersion` for why `--from-version` is exempt.
  if (
    context.manifest.currentVersion < context.meta.standards &&
    options?.explicitFromVersion !== true
  ) {
    return [];
  }

  validateReadmeMigration(context);

  const changes: Change[] = [];
  // Read before any unit writes, so a workspace config this run creates never
  // counts as one the repository's own ignore patterns used to stop at.
  const configDirs = context.units
    .filter(
      (unit) => unit.dir !== "" && readTarget(context, join(unit.dir, OXFMT_CONFIG)) !== undefined,
    )
    .map((unit) => unit.dir);

  for (const unit of context.units) {
    for (const scope of unit.scopes) {
      changes.push(
        ...applyManaged(context, scope, { dir: unit.dir, configDirs }),
        ...applySeeded(context, scope, unit.dir),
        ...applySections(context, scope),
      );
    }
  }

  const blockedByLegacyPlatform =
    context.meta.platform === undefined && hasPlatformScopedEntries(context.scopes);

  // A stale CLI never reaches this point, so the remaining mismatch is either a
  // repository behind the CLI or the `--from-version` self-heal of the Renovate
  // path, and both are rewritten to the running manifest version.
  if (context.meta.standards !== context.manifest.currentVersion && !blockedByLegacyPlatform) {
    writeRepoMeta(cwd, { ...context.meta, standards: context.manifest.currentVersion });
    changes.push({ path: ".repometa.json", action: "bumped" });
  }

  return mergeIgnoreFileChanges(changes);
}
