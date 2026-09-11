import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "./manifest.js";

export const REPO_META_FILE = ".repometa.json";

export type Platform = "forgejo" | "github";

export type ReadmeOwnership = {
  owner: "markdown-themer" | "mdtheme";
};

export type RepoMeta = {
  standards: number;
  visibility: "oss" | "private";
  since: number;
  exceptions?: string[];
  platform?: Platform;
  /** Explicitly delegates README branding to a Markdown generator. */
  readme?: ReadmeOwnership;
  /**
   * Directories that carry their own package manifest, relative to the
   * repository root. Scope detection runs in each of them as well as at the
   * root; see `detectUnits`.
   */
  workspaces?: string[];
};

export function isGeneratedReadme(meta: RepoMeta): boolean {
  return meta.readme?.owner === "markdown-themer" || meta.readme?.owner === "mdtheme";
}

export function isPlatform(value: unknown): value is Platform {
  return value === "github" || value === "forgejo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertReadmeOwnership(value: unknown): asserts value is ReadmeOwnership | undefined {
  if (value === undefined) return;
  if (!isRecord(value) || (value.owner !== "markdown-themer" && value.owner !== "mdtheme")) {
    throw new Error(
      `Invalid ${REPO_META_FILE}: readme.owner must be "mdtheme" or "markdown-themer" when present.`,
    );
  }
}

function assertRepoMeta(value: unknown): asserts value is RepoMeta {
  if (
    !isRecord(value) ||
    typeof value.standards !== "number" ||
    (value.visibility !== "oss" && value.visibility !== "private") ||
    typeof value.since !== "number"
  ) {
    throw new Error(
      `Invalid ${REPO_META_FILE}: expected { standards: number, visibility: "oss" | "private", since: number }`,
    );
  }
  if (value.platform !== undefined && !isPlatform(value.platform)) {
    throw new Error(
      `Invalid ${REPO_META_FILE}: platform must be "github" or "forgejo" when present.`,
    );
  }
  assertReadmeOwnership(value.readme);
  assertWorkspaces(value.workspaces);
}

function isWorkspacePath(value: string): boolean {
  // A workspace path is written into file paths, so it stays inside the
  // repository: relative, forward slashes, no `.` or `..` segment.
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  );
}

function assertWorkspaces(value: unknown): asserts value is string[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid ${REPO_META_FILE}: workspaces must be an array of strings.`);
  }
  const invalid = value.filter((entry) => !isWorkspacePath(entry));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid ${REPO_META_FILE}: workspaces must be relative paths inside the repository — got ${invalid.map((entry) => JSON.stringify(entry)).join(", ")}.`,
    );
  }
  // A directory declared twice would be applied twice and reported twice.
  const duplicates = value.filter((entry, index) => value.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `Invalid ${REPO_META_FILE}: workspaces contains duplicate entries — ${[...new Set(duplicates)].map((entry) => JSON.stringify(entry)).join(", ")}.`,
    );
  }
}

export function readRepoMeta(cwd: string): RepoMeta {
  const path = join(cwd, REPO_META_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `${REPO_META_FILE} not found in ${cwd} — this repository is not standards-managed yet.`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertRepoMeta(raw);
  return raw;
}

export function writeRepoMeta(cwd: string, meta: RepoMeta): void {
  const path = join(cwd, REPO_META_FILE);
  writeFileSync(path, `${JSON.stringify(meta, undefined, 2)}\n`, "utf8");
}

export function detectScopes(cwd: string, manifest: Manifest): string[] {
  return Object.entries(manifest.scopes)
    .filter(([, scope]) => scope.detect === "always" || existsSync(join(cwd, scope.detect)))
    .map(([name]) => name);
}
