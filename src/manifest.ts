import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Platform } from "./repo.js";

export type FileMapping = {
  source: string;
  target: string;
  platform?: Platform;
};

export type SectionSpec = {
  file: string;
  marker: string;
  templates: Record<string, string>;
  platform?: Platform;
};

export type ScopeSpec = {
  detect: string;
  managed: FileMapping[];
  seeded: FileMapping[];
  sections: SectionSpec[];
};

export type Manifest = {
  currentVersion: number;
  scopes: Record<string, ScopeSpec>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertManifest(value: unknown): asserts value is Manifest {
  if (!isRecord(value) || typeof value.currentVersion !== "number" || !isRecord(value.scopes)) {
    throw new Error("Invalid manifest.json: expected { currentVersion: number, scopes: object }");
  }
}

export function getPackageRoot(): string {
  return join(import.meta.dirname, "..");
}

export function loadManifest(packageRoot: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(join(packageRoot, "manifest.json"), "utf8"));
  assertManifest(raw);
  return raw;
}
