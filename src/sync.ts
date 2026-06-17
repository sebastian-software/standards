import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import type { Manifest, ScopeSpec, SectionSpec } from "./manifest.js";
import type { RepoMeta } from "./repo.js";

import { buildPrompt } from "./agent.js";
import { copyrightYears, renderTemplate, upsertSection } from "./branding.js";
import { selectChanges } from "./changes.js";
import { getPackageRoot, loadManifest } from "./manifest.js";
import { detectScopes, readRepoMeta } from "./repo.js";

export type SyncContext = {
  cwd: string;
  packageRoot: string;
  manifest: Manifest;
  meta: RepoMeta;
  scopes: ScopeSpec[];
  currentYear: number;
};

export function createContext(cwd: string, currentYear: number): SyncContext {
  const packageRoot = getPackageRoot();
  const manifest = loadManifest(packageRoot);
  const meta = readRepoMeta(cwd);
  const scopes = detectScopes(cwd, manifest)
    .map((name) => manifest.scopes[name])
    .filter((scope) => scope !== undefined);
  return { cwd, packageRoot, manifest, meta, scopes, currentYear };
}

export function readReference(context: SyncContext, source: string): string {
  return readFileSync(join(context.packageRoot, source), "utf8");
}

export function readTarget(context: SyncContext, target: string): string | undefined {
  const path = join(context.cwd, target);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function renderSectionBody(context: SyncContext, section: SectionSpec): string {
  const templatePath = section.templates[context.meta.visibility];
  if (templatePath === undefined) {
    throw new Error(
      `Section "${section.marker}" has no template for visibility "${context.meta.visibility}".`,
    );
  }
  return renderTemplate(readReference(context, templatePath), {
    copyrightYears: copyrightYears(context.meta.since, context.currentYear),
  });
}

export function sectionState(
  context: SyncContext,
  section: SectionSpec,
): "appended" | "replaced" | "unchanged" {
  const existing = readTarget(context, section.file) ?? "";
  return upsertSection(existing, section.marker, renderSectionBody(context, section)).action;
}

export type PendingChange = {
  file: string;
  version: number;
  scopes: string[];
  content: string;
};

export type PendingPayload = {
  schemaVersion: 1;
  fromVersion: number;
  toVersion: number;
  scopes: string[];
  visibility: RepoMeta["visibility"];
  exceptions: string[];
  prompt: string;
  changes: PendingChange[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function assertPendingChange(value: unknown, index: number): asserts value is PendingChange {
  if (!isRecord(value)) {
    throw new TypeError(`Invalid pending payload: changes[${String(index)}] is not an object.`);
  }
  if (typeof value.file !== "string") {
    throw new TypeError(`Invalid pending payload: changes[${String(index)}].file is not a string.`);
  }
  if (typeof value.version !== "number") {
    throw new TypeError(
      `Invalid pending payload: changes[${String(index)}].version is not a number.`,
    );
  }
  if (!isStringArray(value.scopes)) {
    throw new TypeError(
      `Invalid pending payload: changes[${String(index)}].scopes is not an array of strings.`,
    );
  }
  if (typeof value.content !== "string") {
    throw new TypeError(
      `Invalid pending payload: changes[${String(index)}].content is not a string.`,
    );
  }
}

function assertPayloadHeader(value: Record<string, unknown>): void {
  if (value.schemaVersion !== 1) {
    throw new TypeError(
      `Invalid pending payload: schemaVersion must be 1 (got ${JSON.stringify(value.schemaVersion)}).`,
    );
  }
  if (typeof value.fromVersion !== "number") {
    throw new TypeError("Invalid pending payload: fromVersion is not a number.");
  }
  if (typeof value.toVersion !== "number") {
    throw new TypeError("Invalid pending payload: toVersion is not a number.");
  }
}

function assertPayloadMeta(value: Record<string, unknown>): void {
  if (!isStringArray(value.scopes)) {
    throw new TypeError("Invalid pending payload: scopes is not an array of strings.");
  }
  if (value.visibility !== "oss" && value.visibility !== "private") {
    throw new TypeError(
      `Invalid pending payload: visibility must be "oss" or "private" (got ${JSON.stringify(value.visibility)}).`,
    );
  }
  if (!isStringArray(value.exceptions)) {
    throw new TypeError("Invalid pending payload: exceptions is not an array of strings.");
  }
}

function assertPayloadBody(value: Record<string, unknown>): void {
  if (typeof value.prompt !== "string") {
    throw new TypeError("Invalid pending payload: prompt is not a string.");
  }
  if (!Array.isArray(value.changes)) {
    throw new TypeError("Invalid pending payload: changes is not an array.");
  }
  value.changes.forEach((entry, index) => {
    assertPendingChange(entry, index);
  });
}

export function assertPendingPayload(value: unknown): asserts value is PendingPayload {
  if (!isRecord(value)) {
    throw new TypeError("Invalid pending payload: expected an object.");
  }
  assertPayloadHeader(value);
  assertPayloadMeta(value);
  assertPayloadBody(value);
}

export function buildPendingPayload(cwd: string, fromVersion: number): PendingPayload | undefined {
  const packageRoot = getPackageRoot();
  const manifest = loadManifest(packageRoot);
  const meta = readRepoMeta(cwd);
  const scopeNames = detectScopes(cwd, manifest);
  const changes = selectChanges(packageRoot, fromVersion, scopeNames);
  if (changes.length === 0) {
    return undefined;
  }
  const prompt = buildPrompt({
    packageRoot,
    meta,
    scopeNames,
    fromVersion,
    toVersion: manifest.currentVersion,
    changes,
  });
  return {
    schemaVersion: 1,
    fromVersion,
    toVersion: manifest.currentVersion,
    scopes: scopeNames,
    visibility: meta.visibility,
    exceptions: meta.exceptions ?? [],
    prompt,
    changes: changes.map((entry) => ({
      file: entry.file,
      version: entry.version,
      scopes: entry.scopes,
      content: entry.content,
    })),
  };
}

function resolveEmitPath(cwd: string, raw: string): string {
  return isAbsolute(raw) ? raw : join(cwd, raw);
}

export function writePending(cwd: string, emitPending: string, fromVersion: number): void {
  const path = resolveEmitPath(cwd, emitPending);
  const payload = buildPendingPayload(cwd, fromVersion);
  if (payload === undefined) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}
