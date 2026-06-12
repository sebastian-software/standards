import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Manifest, ScopeSpec, SectionSpec } from "./manifest.js";
import type { RepoMeta } from "./repo.js";

import { copyrightYears, renderTemplate, upsertSection } from "./branding.js";
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
