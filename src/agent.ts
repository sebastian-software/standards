import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChangeEntry } from "./changes.js";
import type { RepoMeta } from "./repo.js";

export const AGENTS = ["claude", "codex"] as const;
export type AgentName = (typeof AGENTS)[number];

// `inline` embeds each changelog body in the prompt — used for the
// self-contained local `standards sync` prompt, where no marker file exists.
// `pending-file` ships next to the `changes` array of `.standards/pending.json`
// (the Renovate flow), so it references that array instead of duplicating the
// bodies into the prompt.
export type ChangesSource = "inline" | "pending-file";

export type PromptInput = {
  packageRoot: string;
  meta: RepoMeta;
  scopeNames: string[];
  fromVersion: number;
  toVersion: number;
  /**
   * The npm version of the CLI that produced this prompt. Only meaningful in
   * `pending-file` mode, where the producing CLI is Renovate's freshly resolved
   * one and the consumer's pin has to be raised to match it.
   */
  cliVersion?: string;
  changes: ChangeEntry[];
  changesSource?: ChangesSource;
};

function renderChangesSection(changes: ChangeEntry[], source: ChangesSource): string {
  if (source === "pending-file") {
    const index = changes.map((entry) => `- ${entry.file} (v${String(entry.version)})`).join("\n");
    // The listed fields mirror `PendingChange` in `sync.ts`; keep them in sync.
    return `The full body of each entry is in the \`changes\` array of
\`.standards/pending.json\` (fields: file, version, scopes, content). Work
through them in order:

${index}`;
  }
  return changes.map((entry) => `### ${entry.file}\n\n${entry.content.trim()}`).join("\n\n");
}

/**
 * The alignment pre-flight, and why it is conditioned on the source.
 *
 * In `pending-file` mode the payload was written by Renovate's freshly resolved
 * CLI, so `cliVersion` names a release the repository does not have yet and
 * raising the pin to it is the first thing to do. In `inline` mode the prompt
 * comes from `standards sync`, which runs the repository's own — possibly
 * stale — CLI; instructing that run to pin to `cliVersion` would tell it to pin
 * to the very version whose staleness is the defect. So the step is omitted
 * there and the drift surfaces through `standards check` instead.
 */
function renderPreflightSection(input: PromptInput, source: ChangesSource): string {
  if (source !== "pending-file") {
    return "";
  }
  const cli = input.cliVersion ?? "the version named in `.standards/pending.json#cliVersion`";
  return `## Pre-flight: align the CLI with the version stamp

This payload was produced by \`@sebastian-software/standards\` version ${cli},
which ships standards version ${String(input.toVersion)}. Do this before the
judgement steps, because every \`standards check\` verdict below is computed
against the manifest of whichever CLI actually runs:

1. Raise the pin. Node-scope repositories set the devDependency to exactly that
   version (\`pnpm add --save-dev --save-exact @sebastian-software/standards@${cli}\`);
   in a nested workspace it belongs in the package.json the CI job installs
   from. Rust-only repositories raise the pinned \`dlx\` version in the CI
   workflow instead.
2. Refresh the lockfile in the same commit, so \`pnpm install --frozen-lockfile\`
   in CI installs the version you just pinned.
3. Verify on two independent values, and never infer compatibility from npm
   semver ordering: the installed \`manifest.json#currentVersion\` must equal
   ${String(input.toVersion)}, and \`.repometa.json#standards\` must equal
   ${String(input.toVersion)} after \`standards apply\`. \`standards check\`
   exits 3 while they disagree.
4. If you cannot complete this — the registry is unreachable, the resolution
   conflicts — still push your best-effort commits and write
   \`.standards/blocked.json\` with \`blocking: true\` and that reason, per the
   Validation section below.

`;
}

/**
 * The gate contract: run it, treat it as hints, always finalize, and leave a
 * machine-readable trace of whatever stayed red. It is invariant across both
 * `ChangesSource` modes, so it lives outside the template.
 */
const VALIDATION_SECTION = `## Validation

After applying the judgement steps, run the repository's own quality gate to
guide your changes. Prefer \`pnpm agent:check:ci\` and fall back to
\`pnpm agent:check\` when the \`:ci\` script is absent; the gate runs in CI mode.

Treat the check output as hints to improve your changes, not as a merge gate:

- Do not stop at the first failing check. Run the gate to completion, collect
  every failure, and fix what you reasonably can while applying the changesets.
- Your work is complete after these best-effort fixes, even if some checks still
  fail — never withhold or revert your commits because a check is red.
- If any check still failed or could not complete, post one separate
  information comment on the pull request that lists each such check with its
  output and notes that this automated environment may lack prerequisites (for
  example environment variables) that the pull request's own CI run has, so a
  human can verify. Post it only when there are failed or incomplete checks; if
  everything passed, post no such comment. It is in addition to the summary
  comment and does not change the always-finalize behavior above.

Publication is not validated completion, so record the difference in a file a
machine can read:

- If any gate check is still failing or incomplete after your best-effort
  fixes, write \`.standards/blocked.json\` — creating \`.standards/\` if it does
  not exist — and commit it with the rest of your work. Its schema is documented
  in the SKILL text above. Set \`blocking: true\` only when the
  \`@sebastian-software/standards\` pin and the version stamp could not be
  brought into agreement; every other unfinished check sets \`blocking: false\`
  and is listed in \`failedChecks\`, because the repository's own lanes already
  report those.
- If nothing is failing or incomplete, delete \`.standards/blocked.json\` when
  it exists from an earlier run, and commit that deletion.
- Writing the marker never replaces pushing. Push in both cases; the marker
  records the state of the result, it does not withhold it.
`;

export function buildPrompt(input: PromptInput): string {
  const skill = readFileSync(join(input.packageRoot, "SKILL.md"), "utf8");
  const source = input.changesSource ?? "inline";
  const changesSection = renderChangesSection(input.changes, source);
  const preflightSection = renderPreflightSection(input, source);

  return `You are migrating this repository to the Sebastian Software org standards.

Context:
- Previous standards version: ${String(input.fromVersion)}, target: ${String(input.toVersion)}
- Detected scopes: ${input.scopeNames.join(", ")}
- visibility: ${input.meta.visibility}, since: ${String(input.meta.since)}
- Documented exceptions: ${JSON.stringify(input.meta.exceptions ?? [])}
- The mechanical part (\`standards apply\`) has already been executed; managed
  files, seeded files and the branding section are up to date. The version stamp
  is *not* something to assume: \`apply\` bumps it only when the CLI that ran is
  at least as new as the repository's stamp, so verify it rather than trusting
  it.

Your job is the judgement part: carry out the migration steps of the changelog
entries below that apply to this repository, following the instructions.

${skill}

${preflightSection}## Changelog entries to execute

${changesSection}

${VALIDATION_SECTION}`;
}

// Force CI mode so the local `standards sync` fallback exercises the same
// `agent:check:ci` path the external pull-mode agent uses, instead of a
// local-dev environment. Overriding a caller-set `CI` is intentional.
export function buildAgentEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, CI: "true" };
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
  const result = spawnSync(binary, args, {
    cwd,
    stdio: "inherit",
    env: buildAgentEnv(process.env),
  });

  if (result.error !== undefined) {
    throw new Error(
      `Could not start ${binary} — is it installed and on the PATH? (${result.error.message})`,
    );
  }
  return result.status ?? 1;
}
