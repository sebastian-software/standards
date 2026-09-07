/**
 * `.standards/blocked.json` — the machine-readable trace an agent run leaves
 * when it pushed a best-effort result it could not validate.
 *
 * The marker is written by the external agent, never by `standards apply`, and
 * it is not a run trigger: run 1 is still started by `.standards/pending.json`
 * plus the `standards:needs-agent` label, so a marker left behind can fail a
 * pull request but can never cause a retry loop. The seeded CI guard fails only
 * on `blocking: true`; a non-blocking marker records context for a reviewer
 * while the repository's own lint, type, test and build lanes report those
 * failures themselves.
 *
 * This type is the one authoritative definition of the schema documented in
 * `SKILL.md`.
 */
export type BlockedState = {
  schemaVersion: 1;
  /**
   * True only for the CLI/stamp alignment class: the pinned
   * `@sebastian-software/standards` version does not ship the manifest version
   * the repository is stamped at, so no check result of this run can be
   * trusted. Every other unfinished check is recorded with `false`.
   */
  blocking: boolean;
  /** One sentence naming what could not be validated, in plain language. */
  reason: string;
  /** ISO 8601 timestamp of the run that wrote the marker. */
  detectedAt: string;
  /** The standards version the migration targets — `pending.json#toVersion`. */
  expectedStandardsVersion: number;
  /** `.repometa.json#standards` as observed, or null when it was unreadable. */
  observedStandardsVersion: null | number;
  /** The npm version the pin has to reach — `pending.json#cliVersion`. */
  expectedCliVersion: null | string;
  /** The npm version actually installed, or null when it was unresolvable. */
  observedCliVersion: null | string;
  /** Gate checks that failed or could not complete, by script name. */
  failedChecks: string[];
  /** What has to happen for this file to be removed again. */
  retry: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function assertNumberOrNull(value: unknown, field: string): void {
  if (value !== null && typeof value !== "number") {
    throw new TypeError(`Invalid blocked state: ${field} is not a number or null.`);
  }
}

function assertStringOrNull(value: unknown, field: string): void {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`Invalid blocked state: ${field} is not a string or null.`);
  }
}

function assertBlockedHeader(value: Record<string, unknown>): void {
  if (value.schemaVersion !== 1) {
    throw new TypeError(
      `Invalid blocked state: schemaVersion must be 1 (got ${JSON.stringify(value.schemaVersion)}).`,
    );
  }
  if (typeof value.blocking !== "boolean") {
    throw new TypeError("Invalid blocked state: blocking is not a boolean.");
  }
  if (typeof value.reason !== "string") {
    throw new TypeError("Invalid blocked state: reason is not a string.");
  }
  if (typeof value.detectedAt !== "string") {
    throw new TypeError("Invalid blocked state: detectedAt is not a string.");
  }
}

function assertBlockedVersions(value: Record<string, unknown>): void {
  if (typeof value.expectedStandardsVersion !== "number") {
    throw new TypeError("Invalid blocked state: expectedStandardsVersion is not a number.");
  }
  assertNumberOrNull(value.observedStandardsVersion, "observedStandardsVersion");
  assertStringOrNull(value.expectedCliVersion, "expectedCliVersion");
  assertStringOrNull(value.observedCliVersion, "observedCliVersion");
}

export function assertBlockedState(value: unknown): asserts value is BlockedState {
  if (!isRecord(value)) {
    throw new TypeError("Invalid blocked state: expected an object.");
  }
  assertBlockedHeader(value);
  assertBlockedVersions(value);
  if (!isStringArray(value.failedChecks)) {
    throw new TypeError("Invalid blocked state: failedChecks is not an array of strings.");
  }
  if (typeof value.retry !== "string") {
    throw new TypeError("Invalid blocked state: retry is not a string.");
  }
}
