import { runApply } from "./apply.js";
import { runCheck } from "./check.js";

const USAGE = `Usage: standards <command> [--cwd <dir>]

Commands:
  check   Report drift between this repository and the org standards (exit 1 on drift)
  apply   Write managed files, seed missing ones, update branding sections, bump the stamp
`;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function getCwd(args: string[]): string {
  const index = args.indexOf("--cwd");
  const value = index === -1 ? undefined : args[index + 1];
  return value ?? process.cwd();
}

function applyCommand(cwd: string, currentYear: number): void {
  const changes = runApply(cwd, currentYear);
  if (changes.length === 0) {
    out("✓ Already up to date with org standards.");
    return;
  }
  for (const change of changes) {
    out(`${change.action.padEnd(8)} ${change.path}`);
  }
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

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = getCwd(rest);
  const currentYear = new Date().getFullYear();

  switch (command) {
    case "apply": {
      applyCommand(cwd, currentYear);
      break;
    }
    case "check": {
      checkCommand(cwd, currentYear);
      break;
    }
    case undefined:
    default: {
      process.stdout.write(USAGE);
      process.exitCode = 2;
    }
  }
}

main();
