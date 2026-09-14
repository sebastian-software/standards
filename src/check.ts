import { join } from "node:path";

import type { ScopeSpec } from "./manifest.js";
import type { SyncContext } from "./sync.js";

import { loadCliName } from "./manifest.js";
import { inspectPin, isExactVersionLiteral } from "./pin.js";
import { readmeMigrationIssues } from "./readme.js";
import { isGeneratedReadme } from "./repo.js";
import { createContext, matchesPlatform, readReference, readTarget, sectionState } from "./sync.js";

export type Finding = {
  kind: "managed" | "pin" | "readme" | "section" | "seeded" | "stamp";
  path: string;
  detail: string;
  /**
   * Whether the finding must stop a pull request from merging rather than being
   * repaired by `standards apply`. Blocking findings form the alignment class,
   * which has two members:
   *
   * - the version stamp mismatch in the direction
   *   `manifest.currentVersion < meta.standards`, where the installed CLI is
   *   older than the repository it is checking and every other verdict it
   *   produces is computed against the wrong manifest;
   * - a `pin` finding: a `package.json` declares `@sebastian-software/standards`
   *   with anything but a bare exact version literal, or a repository with a
   *   standards CI lane declares it nowhere. `package.json` is neither managed
   *   nor seeded, so `apply` cannot repair it.
   *
   * Exit code and write refusal are separate properties. Both members make
   * `standards check` exit `3`; only the stamp mismatch makes `apply` and `sync`
   * refuse to write, because only it means the references themselves are wrong.
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
        !isGeneratedReadme(context.meta),
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
 *
 * `displaySpecifier` is the declared `@sebastian-software/standards` specifier
 * in its **already-redacted** form, as `inspectPin` produces it — never a raw
 * specifier, because this detail reaches stdout from all three commands. When
 * it is not a bare exact version literal, the CLI-behind detail names it and
 * the required form: raising a range or a `catalog:` reference is not a step
 * anybody can follow. `undefined` keeps the wording unchanged.
 */
export function stampFinding(
  stamped: number,
  current: number,
  displaySpecifier: string | undefined,
): Finding | undefined {
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
  const shape =
    displaySpecifier === undefined || isExactVersionLiteral(displaySpecifier)
      ? ""
      : ` The declared specifier is \`${displaySpecifier}\`, which is not a bare exact version literal — declare the pin as one (for example \`0.11.1\`).`;
  return {
    kind: "stamp",
    path: ".repometa.json",
    detail: `standards version is ${String(stamped)}, the installed CLI ships ${String(current)} — the installed CLI is behind the repository; every other finding of this run was computed against the wrong manifest. Raise the \`@sebastian-software/standards\` pin to the release whose manifest is version ${String(stamped)} and refresh the lockfile, then re-run.${shape}`,
    blocking: true,
  };
}

export function runCheck(cwd: string, currentYear: number): Finding[] {
  const context = createContext(cwd, currentYear);
  const findings: Finding[] = [];

  const pin = inspectPin(cwd, context.meta, loadCliName(context.packageRoot));

  const stamp = stampFinding(
    context.meta.standards,
    context.manifest.currentVersion,
    pin.displaySpecifier,
  );
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

  // After the stamp block, so a stamp finding stays first.
  findings.push(...pin.findings);

  if (isGeneratedReadme(context.meta)) {
    findings.push(
      ...readmeMigrationIssues(cwd, context.meta.readme?.owner).map((issue) => ({
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
