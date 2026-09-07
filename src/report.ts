import type { Finding } from "./check.js";

import { stampFinding } from "./check.js";

/**
 * Exit codes are the only signal the seeded CI can read: it calls
 * `standards check` without `--json`, so `3` (blocking) has to be
 * distinguishable from `1` (ordinary drift) without a parser. `2` stays
 * reserved for usage errors.
 */
export const BLOCKING_EXIT_CODE = 3;

export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function formatFinding(finding: Finding): string {
  return `[${finding.kind}]${finding.blocking ? "[blocking]" : ""} ${finding.path}: ${finding.detail}`;
}

export function checkExitCode(total: number, blocking: number): number {
  if (blocking > 0) return BLOCKING_EXIT_CODE;
  return total > 0 ? 1 : 0;
}

export function reportFindingsJson(findings: Finding[], blocking: number): void {
  out(
    JSON.stringify({
      findings: findings.map((finding) => ({
        kind: finding.kind,
        path: finding.path,
        detail: finding.detail,
        blocking: finding.blocking,
      })),
      total: findings.length,
      blocking,
    }),
  );
}

export function reportFindingsText(findings: Finding[], blocking: number): void {
  if (findings.length === 0) {
    out("✓ Repository matches org standards.");
    return;
  }
  for (const finding of findings) {
    out(formatFinding(finding));
  }
  const suffix = blocking > 0 ? `, ${String(blocking)} blocking` : "";
  out(
    `${String(findings.length)} finding(s)${suffix}. Run \`standards apply\` for the mechanical part.`,
  );
}

/**
 * The stale-CLI guard `apply` and `sync` share. `runApply` writes nothing when
 * the running CLI is older than the repository's stamp, which used to leave
 * both commands announcing a successful no-op for a repository `standards
 * check` refuses with exit `3`. They now report the finding `check` builds for
 * this direction and carry its exit code, so one defect reads the same from
 * every entry point. Returns whether the caller must stop.
 */
export function reportStaleCli(stamped: number, current: number): boolean {
  const finding = stampFinding(stamped, current);
  if (finding?.blocking !== true) {
    return false;
  }
  out(formatFinding(finding));
  process.exitCode = BLOCKING_EXIT_CODE;
  return true;
}
