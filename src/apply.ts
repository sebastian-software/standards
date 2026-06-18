import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ScopeSpec } from "./manifest.js";
import type { RepoMeta } from "./repo.js";
import type { SyncContext } from "./sync.js";

import { upsertSection } from "./branding.js";
import { writeRepoMeta } from "./repo.js";
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

function applyManaged(context: SyncContext, scope: ScopeSpec): Change[] {
  return scope.managed
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .flatMap((mapping) => {
      const reference = readReference(context, mapping.source);
      const actual = readTarget(context, mapping.target);
      if (actual === reference) {
        return [];
      }
      writeTarget(context.cwd, mapping.target, reference);
      return [
        {
          path: mapping.target,
          action: actual === undefined ? ("created" as const) : ("updated" as const),
        },
      ];
    });
}

function applySeeded(context: SyncContext, scope: ScopeSpec): Change[] {
  return scope.seeded
    .filter((mapping) => matchesPlatform(mapping.platform, context.meta.platform))
    .flatMap((mapping) => {
      if (readTarget(context, mapping.target) !== undefined) {
        return [];
      }
      writeTarget(context.cwd, mapping.target, readReference(context, mapping.source));
      return [{ path: mapping.target, action: "seeded" as const }];
    });
}

function applySections(context: SyncContext, scope: ScopeSpec): Change[] {
  return scope.sections
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

export function runApply(cwd: string, currentYear: number, preReadMeta?: RepoMeta): Change[] {
  const context = createContext(cwd, currentYear, preReadMeta);
  const changes: Change[] = [];

  for (const scope of context.scopes) {
    changes.push(
      ...applyManaged(context, scope),
      ...applySeeded(context, scope),
      ...applySections(context, scope),
    );
  }

  const blockedByLegacyPlatform =
    context.meta.platform === undefined && hasPlatformScopedEntries(context.scopes);

  if (context.meta.standards !== context.manifest.currentVersion && !blockedByLegacyPlatform) {
    writeRepoMeta(cwd, { ...context.meta, standards: context.manifest.currentVersion });
    changes.push({ path: ".repometa.json", action: "bumped" });
  }

  return changes;
}
