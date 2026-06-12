import type { ScopeSpec } from "./manifest.js";
import type { SyncContext } from "./sync.js";

import { createContext, readReference, readTarget, sectionState } from "./sync.js";

export type Finding = {
  kind: "managed" | "section" | "seeded" | "stamp";
  path: string;
  detail: string;
};

function checkManaged(context: SyncContext, scope: ScopeSpec): Finding[] {
  return scope.managed.flatMap((mapping) => {
    const actual = readTarget(context, mapping.target);
    if (actual === undefined) {
      return [
        { kind: "managed" as const, path: mapping.target, detail: "managed file is missing" },
      ];
    }
    if (actual !== readReference(context, mapping.source)) {
      return [
        {
          kind: "managed" as const,
          path: mapping.target,
          detail: "managed file differs from reference",
        },
      ];
    }
    return [];
  });
}

function checkSeeded(context: SyncContext, scope: ScopeSpec): Finding[] {
  return scope.seeded
    .filter((mapping) => readTarget(context, mapping.target) === undefined)
    .map((mapping) => ({
      kind: "seeded" as const,
      path: mapping.target,
      detail: "seeded file is missing",
    }));
}

function checkSections(context: SyncContext, scope: ScopeSpec): Finding[] {
  return scope.sections.flatMap((section) => {
    const state = sectionState(context, section);
    if (state === "unchanged") {
      return [];
    }
    return [
      {
        kind: "section" as const,
        path: section.file,
        detail: `section "${section.marker}" is ${state === "appended" ? "missing" : "outdated"}`,
      },
    ];
  });
}

export function runCheck(cwd: string, currentYear: number): Finding[] {
  const context = createContext(cwd, currentYear);
  const findings: Finding[] = [];

  if (context.meta.standards !== context.manifest.currentVersion) {
    findings.push({
      kind: "stamp",
      path: ".repometa.json",
      detail: `standards version is ${String(context.meta.standards)}, current is ${String(context.manifest.currentVersion)} — see changes/ for migration steps`,
    });
  }

  for (const scope of context.scopes) {
    findings.push(
      ...checkManaged(context, scope),
      ...checkSeeded(context, scope),
      ...checkSections(context, scope),
    );
  }

  return findings;
}
