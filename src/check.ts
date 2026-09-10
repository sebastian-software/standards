import { join } from "node:path";

import type { ScopeSpec } from "./manifest.js";
import type { SyncContext } from "./sync.js";

import { markdownThemerMigrationIssues } from "./readme.js";
import { isMarkdownThemerReadme } from "./repo.js";
import { createContext, matchesPlatform, readReference, readTarget, sectionState } from "./sync.js";

export type Finding = {
  kind: "managed" | "readme" | "section" | "seeded" | "stamp";
  path: string;
  detail: string;
  /**
   * Whether the finding must stop a pull request from merging rather than being
   * repaired by `standards apply`. Exactly one finding is blocking: the version
   * stamp mismatch in the direction `manifest.currentVersion < meta.standards`,
   * where the installed CLI is older than the repository it is checking and
   * every other verdict it produces is computed against the wrong manifest.
   * Every other finding — managed, seeded, section, the repository-behind
   * direction of the stamp check and the missing-platform stamp finding — is
   * non-blocking: `standards apply` or a documented migration step repairs it.
   */
  blocking: boolean;
};

function checkManaged(context: SyncContext, scope: ScopeSpec, dir: string): Finding[] {
  return scope.managed
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .flatMap((mapping) => {
      const target = join(dir, mapping.target);
      const actual = readTarget(context, target);
      if (actual === undefined) {
        return [
          {
            kind: "managed" as const,
            path: target,
            detail: "managed file is missing",
            blocking: false,
          },
        ];
      }
      if (actual !== readReference(context, mapping.source)) {
        return [
          {
            kind: "managed" as const,
            path: target,
            detail: "managed file differs from reference",
            blocking: false,
          },
        ];
      }
      return [];
    });
}

function checkSeeded(context: SyncContext, scope: ScopeSpec, dir: string): Finding[] {
  return scope.seeded
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .filter((mapping) => readTarget(context, join(dir, mapping.target)) === undefined)
    .map((mapping) => ({
      kind: "seeded" as const,
      path: join(dir, mapping.target),
      detail: "seeded file is missing",
      blocking: false,
    }));
}

function checkSections(context: SyncContext, scope: ScopeSpec): Finding[] {
  return scope.sections
    .filter(
      (section) =>
        section.file !== "README.md" ||
        section.marker !== "sebastian-software-branding" ||
        !isMarkdownThemerReadme(context.meta),
    )
    .filter((section) => matchesPlatform(section.platform, context.meta.platform))
    .flatMap((section) => {
      const state = sectionState(context, section);
      if (state === "unchanged") {
        return [];
      }
      return [
        {
          kind: "section" as const,
          path: section.file,
          detail: `section "${section.marker}" is ${state === "appended" ? "missing" : "outdated"}`,
          blocking: false,
        },
      ];
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

/**
 * The version stamp check, stated directionally. The two directions are
 * different defects and need different words: a repository behind its CLI is
 * ordinary drift that `standards apply` and the changelog entries repair, while
 * a CLI behind its repository means the whole check ran against an outdated
 * manifest — the repository cannot be validated at all until the pin is raised.
 *
 * Exported because `apply` and `sync` report the very same mismatch when they
 * refuse to touch a repository stamped ahead of them. One builder keeps the
 * three commands from drifting into three different wordings for one defect.
 */
export function stampFinding(stamped: number, current: number): Finding | undefined {
  if (stamped === current) {
    return undefined;
  }
  if (stamped < current) {
    return {
      kind: "stamp",
      path: ".repometa.json",
      detail: `standards version is ${String(stamped)}, the installed CLI ships ${String(current)} — the repository is behind the installed CLI; see changes/ for migration steps`,
      blocking: false,
    };
  }
  return {
    kind: "stamp",
    path: ".repometa.json",
    detail: `standards version is ${String(stamped)}, the installed CLI ships ${String(current)} — the installed CLI is behind the repository; every other finding of this run was computed against the wrong manifest. Raise the \`@sebastian-software/standards\` pin to the release whose manifest is version ${String(stamped)} and refresh the lockfile, then re-run.`,
    blocking: true,
  };
}

export function runCheck(cwd: string, currentYear: number): Finding[] {
  const context = createContext(cwd, currentYear);
  const findings: Finding[] = [];

  const stamp = stampFinding(context.meta.standards, context.manifest.currentVersion);
  if (stamp !== undefined) {
    findings.push(stamp);
  }

  if (context.meta.platform === undefined && hasPlatformScopedEntries(context.scopes)) {
    findings.push({
      kind: "stamp",
      path: ".repometa.json",
      detail:
        "platform is missing; run `standards init --force --platform <github|forgejo>` to set it",
      blocking: false,
    });
  }

  if (isMarkdownThemerReadme(context.meta)) {
    findings.push(
      ...markdownThemerMigrationIssues(cwd).map((issue) => ({
        kind: "readme" as const,
        path: issue.path,
        detail: issue.detail,
        blocking: false,
      })),
    );
  }

  for (const unit of context.units) {
    for (const scope of unit.scopes) {
      findings.push(
        ...checkManaged(context, scope, unit.dir),
        ...checkSeeded(context, scope, unit.dir),
        ...checkSections(context, scope),
      );
    }
  }

  return findings;
}
