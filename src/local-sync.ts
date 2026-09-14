import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentName } from "./agent.js";
import type { RepoMeta } from "./repo.js";
import type { PendingPayload } from "./sync.js";

import { buildPrompt, runAgent } from "./agent.js";
import { runApply } from "./apply.js";
import { runCheck } from "./check.js";
import { blockedMarkerProblem, markerExists, PENDING_FILE } from "./ci.js";
import { getPackageRoot, loadManifest } from "./manifest.js";
import { readRepoMeta } from "./repo.js";
import {
  checkExitCode,
  out,
  reportApplied,
  reportFindingsText,
  reportStaleCli,
  staleDisplaySpecifier,
} from "./report.js";
import { assertPendingPayload, buildPendingPayload, writePending } from "./sync.js";

export function runLocalSync(
  cwd: string,
  currentYear: number,
  options: { agent: AgentName; dryRun: boolean },
): void {
  const manifest = loadManifest(getPackageRoot());
  const meta = readRepoMeta(cwd);

  // Stop before `apply` and before the agent: a CLI that cannot validate this
  // repository must not dispatch an agent to change it either.
  if (
    reportStaleCli(
      meta.standards,
      manifest.currentVersion,
      staleDisplaySpecifier(cwd, meta, manifest.currentVersion),
    )
  ) {
    return;
  }

  const baseline = pendingBaseline(cwd, meta.standards, manifest.currentVersion);
  const payload = buildPendingPayload(cwd, baseline, meta);
  if (options.dryRun) {
    previewSync(payload, meta);
    return;
  }

  // Persist before apply: even an interrupted mechanical run must retain its baseline.
  if (payload !== undefined) writePending(cwd, PENDING_FILE, payload);
  reportApplied(runApply(cwd, currentYear, { preReadMeta: meta }));
  if (payload === undefined) {
    out("✓ No changelog entries require agent work.");
    return;
  }

  finishMigration({ cwd, currentYear, agent: options.agent, payload });
}

function previewSync(payload: PendingPayload | undefined, meta: RepoMeta): void {
  if (payload === undefined) {
    out("✓ No changelog entries require agent work.");
    return;
  }
  process.stdout.write(
    localPrompt(
      buildPrompt({
        ...payload,
        packageRoot: getPackageRoot(),
        meta,
        scopeNames: payload.scopes,
        changesSource: "inline",
      }),
    ),
  );
}

function localPrompt(prompt: string): string {
  return `${prompt}

## Local sync execution

This is a local migration. Leave changes in the working tree for the caller to
review; do not commit, push, post comments, or change pull request labels.
The sync command owns .standards/pending.json: do not delete or edit it.
Use standards check while working; standards ci intentionally fails while
the pending marker exists. Run the repository's code checks and report failures.
`;
}

function finishMigration({
  cwd,
  currentYear,
  agent,
  payload,
}: {
  cwd: string;
  currentYear: number;
  agent: AgentName;
  payload: PendingPayload;
}): void {
  let completed = false;
  try {
    out(`Running ${agent}…`);
    process.exitCode = runAgent(agent, localPrompt(payload.prompt), cwd);
    if (process.exitCode !== 0) return;
    const findings = runCheck(cwd, currentYear);
    const blocked = blockedMarkerProblem(cwd);
    if (findings.length > 0 || blocked !== undefined) {
      reportFindingsText(findings, findings.filter((finding) => finding.blocking).length);
      if (blocked !== undefined) process.stderr.write(`${blocked}\n`);
      process.exitCode = Math.max(
        1,
        checkExitCode(findings.length, findings.filter((finding) => finding.blocking).length),
      );
      return;
    }
    completed = true;
  } finally {
    // An agent may remove the marker before failing; restore it for a retry.
    writePending(cwd, PENDING_FILE, completed ? undefined : payload);
  }
}

function pendingBaseline(cwd: string, stamped: number, current: number): number {
  if (!markerExists(cwd, PENDING_FILE)) return stamped;
  const payload: unknown = JSON.parse(readFileSync(join(cwd, PENDING_FILE), "utf8"));
  assertPendingPayload(payload);
  if (
    !Number.isSafeInteger(payload.fromVersion) ||
    payload.fromVersion < 0 ||
    payload.fromVersion > stamped ||
    !Number.isSafeInteger(payload.toVersion) ||
    payload.toVersion <= payload.fromVersion ||
    payload.toVersion > current
  ) {
    throw new Error(
      "The pending migration does not match this repository or CLI. Use the CLI that produced it and preserve the marker until the migration is complete.",
    );
  }
  return payload.fromVersion;
}
