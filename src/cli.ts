import type { AgentName } from "./agent.js";
import type { InitOptions, Visibility } from "./init.js";

import { AGENTS, buildPrompt, runAgent } from "./agent.js";
import { runApply } from "./apply.js";
import { selectChanges } from "./changes.js";
import { runCheck } from "./check.js";
import { InitError, parseSinceFlag, parseVisibilityFlag, runInit } from "./init.js";
import { getPackageRoot, loadManifest } from "./manifest.js";
import { detectScopes, readRepoMeta } from "./repo.js";
import { writePending } from "./sync.js";

const USAGE = `Usage: standards <command> [--cwd <dir>]

Commands:
  init    Create .repometa.json interactively (or via flags for CI)
          [--visibility oss|private] [--since <int>] [--yes] [--force]
  check   Report drift between this repository and the org standards (exit 1 on drift)
  apply   Write managed files, seed missing ones, update branding sections, bump the stamp
          [--from-version <int>: explicit baseline for pending-marker selection]
          [--emit-pending <path>: write a JSON marker describing pending judgement work]
  sync    apply + run an agent (claude or codex) on the changelog entries that need judgement
          [--agent claude|codex] [--dry-run: print the agent prompt instead of running]
`;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function getCwd(args: string[]): string {
  const index = args.indexOf("--cwd");
  const value = index === -1 ? undefined : args[index + 1];
  return value ?? process.cwd();
}

function getAgent(args: string[]): AgentName {
  const index = args.indexOf("--agent");
  const value = index === -1 ? "claude" : args[index + 1];
  const agent = AGENTS.find((candidate) => candidate === value);
  if (agent === undefined) {
    throw new Error(`Unknown agent "${value ?? ""}" — expected one of: ${AGENTS.join(", ")}`);
  }
  return agent;
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const raw = args[index + 1];
  if (raw === undefined || raw === "" || raw.startsWith("--")) {
    throw new Error(`${flag} requires a value argument.`);
  }
  return raw;
}

function getFromVersion(args: string[]): number | undefined {
  const raw = getFlagValue(args, "--from-version");
  if (raw === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`--from-version requires a non-negative integer — got ${JSON.stringify(raw)}.`);
  }
  return Number(raw);
}

function getEmitPending(args: string[]): string | undefined {
  return getFlagValue(args, "--emit-pending");
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getVisibilityFlag(args: string[]): undefined | Visibility {
  const raw = getFlagValue(args, "--visibility");
  return raw === undefined ? undefined : parseVisibilityFlag(raw);
}

function getSinceFlag(args: string[], currentYear: number): number | undefined {
  const raw = getFlagValue(args, "--since");
  return raw === undefined ? undefined : parseSinceFlag(raw, currentYear);
}

function reportApplied(changes: ReturnType<typeof runApply>): void {
  for (const change of changes) {
    out(`${change.action.padEnd(8)} ${change.path}`);
  }
}

async function initCommand(cwd: string, currentYear: number, args: string[]): Promise<void> {
  const yes = hasFlag(args, "--yes");
  const force = hasFlag(args, "--force");
  const visibility = getVisibilityFlag(args);
  const since = getSinceFlag(args, currentYear);
  const isTty = process.stdin.isTTY;

  if (!yes && !isTty) {
    throw new InitError(
      "No TTY available for interactive prompts. Pass --yes (with --visibility/--since as needed) for non-interactive mode.",
    );
  }

  const options: InitOptions = {
    force,
    interactive: !yes && isTty,
    ...(visibility === undefined ? {} : { visibility }),
    ...(since === undefined ? {} : { since }),
  };
  const previous = force ? safeReadRepoMeta(cwd) : undefined;
  const meta = await runInit(cwd, currentYear, options);
  reportInitResult(meta, force, previous);
}

function safeReadRepoMeta(cwd: string): ReturnType<typeof readRepoMeta> | undefined {
  try {
    return readRepoMeta(cwd);
  } catch {
    return undefined;
  }
}

function reportInitResult(
  meta: Awaited<ReturnType<typeof runInit>>,
  force: boolean,
  previous: ReturnType<typeof readRepoMeta> | undefined,
): void {
  if (force && previous !== undefined) {
    out(
      `Reset .repometa.json (was: standards=${String(previous.standards)}, visibility=${previous.visibility}, since=${String(previous.since)})`,
    );
  } else if (force) {
    out("Reset .repometa.json (previous content was not parseable).");
  }
  out(
    `Wrote .repometa.json (standards=0, visibility=${meta.visibility}, since=${String(meta.since)})`,
  );
  out("Next: run `standards apply` to populate managed and seeded files.");
}

function applyCommand(cwd: string, currentYear: number, args: string[]): void {
  const explicitFromVersion = getFromVersion(args);
  const emitPending = getEmitPending(args);
  const preApplyStandards = readRepoMeta(cwd).standards;
  const effectiveFromVersion = explicitFromVersion ?? preApplyStandards;

  const changes = runApply(cwd, currentYear);

  if (emitPending !== undefined) {
    writePending(cwd, emitPending, effectiveFromVersion);
  }

  if (changes.length === 0) {
    out("✓ Already up to date with org standards.");
    return;
  }
  reportApplied(changes);
  out(`Applied ${String(changes.length)} change(s). Run your checks and commit.`);
}

function checkCommand(cwd: string, currentYear: number): void {
  const findings = runCheck(cwd, currentYear);
  if (findings.length === 0) {
    out("✓ Repository matches org standards.");
    return;
  }
  for (const finding of findings) {
    out(`[${finding.kind}] ${finding.path}: ${finding.detail}`);
  }
  out(`${String(findings.length)} finding(s). Run \`standards apply\` for the mechanical part.`);
  process.exitCode = 1;
}

function syncCommand(cwd: string, currentYear: number, args: string[]): void {
  const agent = getAgent(args);
  const packageRoot = getPackageRoot();
  const manifest = loadManifest(packageRoot);
  const fromVersion = readRepoMeta(cwd).standards;

  reportApplied(runApply(cwd, currentYear));

  const scopeNames = detectScopes(cwd, manifest);
  const entries = selectChanges(packageRoot, fromVersion, scopeNames);
  if (entries.length === 0) {
    out("✓ No changelog entries require agent work.");
    return;
  }

  const prompt = buildPrompt({
    packageRoot,
    meta: readRepoMeta(cwd),
    scopeNames,
    fromVersion,
    toVersion: manifest.currentVersion,
    changes: entries,
  });
  dispatchAgent({ args, agent, prompt, cwd });
}

type AgentDispatch = {
  args: string[];
  agent: AgentName;
  prompt: string;
  cwd: string;
};

function dispatchAgent(dispatch: AgentDispatch): void {
  if (dispatch.args.includes("--dry-run")) {
    process.stdout.write(dispatch.prompt);
    return;
  }
  out(`Running ${dispatch.agent}…`);
  process.exitCode = runAgent(dispatch.agent, dispatch.prompt, dispatch.cwd);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = getCwd(rest);
  const currentYear = new Date().getFullYear();

  switch (command) {
    case "init": {
      await initCommand(cwd, currentYear, rest);
      break;
    }
    case "apply": {
      applyCommand(cwd, currentYear, rest);
      break;
    }
    case "check": {
      checkCommand(cwd, currentYear);
      break;
    }
    case "sync": {
      syncCommand(cwd, currentYear, rest);
      break;
    }
    case undefined:
    default: {
      process.stdout.write(USAGE);
      process.exitCode = 2;
    }
  }
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
