import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChangeEntry } from "./changes.js";
import type { RepoMeta } from "./repo.js";

export const AGENTS = ["claude", "codex"] as const;
export type AgentName = (typeof AGENTS)[number];

export type PromptInput = {
  packageRoot: string;
  meta: RepoMeta;
  scopeNames: string[];
  fromVersion: number;
  toVersion: number;
  changes: ChangeEntry[];
};

export function buildPrompt(input: PromptInput): string {
  const skill = readFileSync(join(input.packageRoot, "SKILL.md"), "utf8");
  const changeSections = input.changes
    .map((entry) => `### ${entry.file}\n\n${entry.content.trim()}`)
    .join("\n\n");

  return `You are migrating this repository to the Sebastian Software org standards.

Context:
- Previous standards version: ${String(input.fromVersion)}, target: ${String(input.toVersion)}
- Detected scopes: ${input.scopeNames.join(", ")}
- visibility: ${input.meta.visibility}, since: ${String(input.meta.since)}
- Documented exceptions: ${JSON.stringify(input.meta.exceptions ?? [])}
- The mechanical part (\`standards apply\`) has already been executed; managed
  files, seeded files, branding section and the version stamp are up to date.

Your job is the judgement part: carry out the migration steps of the changelog
entries below that apply to this repository, following the instructions.

${skill}

## Changelog entries to execute

${changeSections}
`;
}

export function runAgent(agent: AgentName, prompt: string, cwd: string): number {
  const invocations: Record<AgentName, { binary: string; args: string[] }> = {
    claude: {
      binary: "claude",
      args: [
        "-p",
        prompt,
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash(pnpm:*)",
        "Bash(git:*)",
      ],
    },
    codex: {
      binary: "codex",
      args: ["exec", "--full-auto", prompt],
    },
  };

  const { binary, args } = invocations[agent];
  const result = spawnSync(binary, args, { cwd, stdio: "inherit" });

  if (result.error !== undefined) {
    throw new Error(
      `Could not start ${binary} — is it installed and on the PATH? (${result.error.message})`,
    );
  }
  return result.status ?? 1;
}
