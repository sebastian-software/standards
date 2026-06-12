import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "./manifest.js";

export const REPO_META_FILE = ".repometa.json";

export type RepoMeta = {
  standards: number;
  visibility: "oss" | "private";
  since: number;
  exceptions?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  writeFileSync(path, `${JSON.stringify(meta, undefined, 2)}\n`);
}

export function detectScopes(cwd: string, manifest: Manifest): string[] {
  return Object.entries(manifest.scopes)
    .filter(([, scope]) => scope.detect === "always" || existsSync(join(cwd, scope.detect)))
    .map(([name]) => name);
}
