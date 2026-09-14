import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { assertBlockedState } from "./blocked.js";

export const PENDING_FILE = ".standards/pending.json";
const BLOCKED_FILE = ".standards/blocked.json";

/** Missing is allowed; unreadable files and dangling symlinks must fail closed. */
export function markerExists(cwd: string, file: string): boolean {
  try {
    lstatSync(join(cwd, file));
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** The same marker contract is used by local sync and every CI platform. */
export function blockedMarkerProblem(cwd: string): string | undefined {
  if (!markerExists(cwd, BLOCKED_FILE)) return undefined;
  try {
    const state: unknown = JSON.parse(readFileSync(join(cwd, BLOCKED_FILE), "utf8"));
    assertBlockedState(state);
    return state.blocking ? `${BLOCKED_FILE}: the agent could not validate its result.` : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `${BLOCKED_FILE}: invalid or unreadable marker — ${message}`;
  }
}

export function ciMarkerProblems(cwd: string): string[] {
  const blocked = blockedMarkerProblem(cwd);
  return [
    ...(markerExists(cwd, PENDING_FILE)
      ? [`${PENDING_FILE}: agent work is still pending; resume standards sync.`]
      : []),
    ...(blocked === undefined ? [] : [blocked]),
  ];
}
