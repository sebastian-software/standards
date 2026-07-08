import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { runApply } from "../src/apply.js";
import { copyrightYears, renderTemplate, upsertSection } from "../src/branding.js";
import { runCheck } from "../src/check.js";
import { initCommand } from "../src/cli.js";
import {
  detectFirstCommitYear,
  detectPlatform,
  InitError,
  parsePlatformChoice,
  parsePlatformFlag,
  parseSinceFlag,
  parseVisibilityChoice,
  parseVisibilityFlag,
  runInit,
} from "../src/init.js";
import {
  assertPendingPayload,
  buildPendingPayload,
  matchesPlatform,
  writePending,
} from "../src/sync.js";

const YEAR = 2026;

describe("copyrightYears", () => {
  it("renders a single year when since equals current", () => {
    expect(copyrightYears(YEAR, YEAR)).toBe("2026");
  });

  it("renders a range when since is older", () => {
    expect(copyrightYears(2011, YEAR)).toBe("2011&ndash;2026");
  });
});

describe("renderTemplate", () => {
  it("replaces known variables and keeps unknown ones", () => {
    expect(renderTemplate("a {{x}} b {{y}}", { x: "1" })).toBe("a 1 b {{y}}");
  });
});

describe("upsertSection", () => {
  it("appends a missing section with a separator", () => {
    const result = upsertSection("# Title\n", "m", "body");
    expect(result.action).toBe("appended");
    expect(result.content).toContain("<!-- m:start -->\n\nbody\n<!-- m:end -->");
    expect(result.content).toContain("\n---\n");
  });

  it("replaces an outdated section in place", () => {
    const old = upsertSection("# Title\n", "m", "old").content;
    const result = upsertSection(old, "m", "new");
    expect(result.action).toBe("replaced");
    expect(result.content).toContain("new");
    expect(result.content).not.toContain("old");
  });

  it("reports unchanged when the section is current", () => {
    const current = upsertSection("# Title\n", "m", "same").content;
    expect(upsertSection(current, "m", "same").action).toBe("unchanged");
  });
});

function createFixtureRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "standards-test-"));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  writeFileSync(join(cwd, "README.md"), "# Demo\n");
  writeFileSync(
    join(cwd, ".repometa.json"),
    `${JSON.stringify({ standards: 0, visibility: "oss", since: 2020, platform: "github" }, undefined, 2)}\n`,
  );
  return cwd;
}

describe("apply and check", () => {
  it("brings a fresh node repo up to standards and detects drift afterwards", () => {
    const cwd = createFixtureRepo();

    const changes = runApply(cwd, YEAR);
    const paths = changes.map((change) => change.path);
    expect(paths).toContain(".oxfmtrc.json");
    expect(paths).toContain("eslint.config.ts");
    expect(paths).toContain("README.md");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".repometa.json");

    const readme = readFileSync(join(cwd, "README.md"), "utf8");
    expect(readme).toContain("sebastian-software-branding:start");
    expect(readme).toContain("2020&ndash;2026");

    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(agents).toContain("sebastian-software-consumer-agents:start");
    expect(agents).toContain("Do not hand-edit managed files");

    expect(runCheck(cwd, YEAR)).toStrictEqual([]);

    writeFileSync(join(cwd, ".oxfmtrc.json"), "{}\n");
    const findings = runCheck(cwd, YEAR);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("managed");

    const repaired = runApply(cwd, YEAR);
    expect(repaired).toHaveLength(1);
    expect(runCheck(cwd, YEAR)).toStrictEqual([]);
  });

  it("detects drift in the consumer AGENTS section", () => {
    const cwd = createFixtureRepo();

    runApply(cwd, YEAR);
    writeFileSync(
      join(cwd, "AGENTS.md"),
      "<!-- sebastian-software-consumer-agents:start -->\nstale\n<!-- sebastian-software-consumer-agents:end -->\n",
    );

    const findings = runCheck(cwd, YEAR);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "section",
      path: "AGENTS.md",
      detail: 'section "sebastian-software-consumer-agents" is outdated',
    });
  });

  it("uses the plain footer for private repositories and keeps seeded files untouched", () => {
    const cwd = createFixtureRepo();
    writeFileSync(
      join(cwd, ".repometa.json"),
      `${JSON.stringify({ standards: 0, visibility: "private", since: YEAR }, undefined, 2)}\n`,
    );
    writeFileSync(join(cwd, "eslint.config.ts"), "// custom local config\n");

    runApply(cwd, YEAR);

    const readme = readFileSync(join(cwd, "README.md"), "utf8");
    expect(readme).toContain("All rights reserved");
    expect(readme).not.toContain("Work with us");
    expect(readFileSync(join(cwd, "eslint.config.ts"), "utf8")).toBe("// custom local config\n");
  });
});

describe("selectChanges and buildPrompt", () => {
  it("filters changelog entries by version and scope", async () => {
    const { selectChanges } = await import("../src/changes.js");
    const { getPackageRoot } = await import("../src/manifest.js");
    const root = getPackageRoot();

    expect(selectChanges(root, 0, ["common"]).map((entry) => entry.version)).toStrictEqual([
      1, 2, 3, 7,
    ]);
    expect(selectChanges(root, 1, ["common", "node"]).map((entry) => entry.version)).toStrictEqual([
      2, 3, 4, 5, 6, 7,
    ]);
    expect(selectChanges(root, 6, ["common", "node"]).map((entry) => entry.version)).toStrictEqual([
      7,
    ]);
    expect(selectChanges(root, 0, ["rust"])).toHaveLength(0);
  });

  it("builds an agent prompt containing skill and changelog", async () => {
    const { buildPrompt } = await import("../src/agent.js");
    const { selectChanges } = await import("../src/changes.js");
    const { getPackageRoot } = await import("../src/manifest.js");
    const root = getPackageRoot();

    const changes = selectChanges(root, 0, ["common", "node"]);
    const prompt = buildPrompt({
      packageRoot: root,
      meta: { standards: 1, visibility: "oss", since: 2020 },
      scopeNames: ["common", "node"],
      fromVersion: 0,
      toVersion: 2,
      changes,
    });

    expect(prompt).toContain("repository standards — agent instructions");
    expect(prompt).toContain("0001-baseline.md");
    expect(prompt).toContain("0002-renovate-pending.md");
    expect(prompt).toContain("0003-platform-aware-ci.md");
    expect(prompt).toContain("visibility: oss");
    // inline mode embeds the full changelog bodies — the positive
    // counterpart to the pending-file test, which asserts they are absent.
    expect(changes.length).toBeGreaterThan(0);
    for (const entry of changes) {
      expect(entry.content.trim().length).toBeGreaterThan(0);
      expect(prompt).toContain(entry.content.trim());
    }
  });

  it("instructs the agent to run the gate in CI mode as non-blocking hints", async () => {
    const { buildPrompt } = await import("../src/agent.js");
    const { selectChanges } = await import("../src/changes.js");
    const { getPackageRoot } = await import("../src/manifest.js");
    const root = getPackageRoot();

    const prompt = buildPrompt({
      packageRoot: root,
      meta: { standards: 1, visibility: "oss", since: 2020 },
      scopeNames: ["common", "node"],
      fromVersion: 0,
      toVersion: 2,
      changes: selectChanges(root, 0, ["common", "node"]),
    });

    expect(prompt).toContain("## Validation");
    expect(prompt).toContain("pnpm agent:check:ci");
    expect(prompt).toContain("pnpm agent:check");
    expect(prompt).toContain("Do not stop at the first failing check");
    // Checks are hints, not a merge gate: commits are never withheld.
    expect(prompt).toContain("never withhold or revert your commits");
  });

  it("forces CI mode in the agent environment, overriding any inherited CI", async () => {
    const { buildAgentEnv } = await import("../src/agent.js");

    expect(buildAgentEnv({}).CI).toBe("true");
    expect(buildAgentEnv({ CI: "false" }).CI).toBe("true");
    expect(buildAgentEnv({ PATH: "/usr/bin" }).PATH).toBe("/usr/bin");
  });

  it("references the pending.json changes array instead of embedding bodies", async () => {
    const { buildPrompt } = await import("../src/agent.js");
    const { selectChanges } = await import("../src/changes.js");
    const { getPackageRoot } = await import("../src/manifest.js");
    const root = getPackageRoot();
    const changes = selectChanges(root, 0, ["common", "node"]);

    const prompt = buildPrompt({
      packageRoot: root,
      meta: { standards: 1, visibility: "oss", since: 2020 },
      scopeNames: ["common", "node"],
      fromVersion: 0,
      toVersion: 2,
      changes,
      changesSource: "pending-file",
    });

    expect(prompt).toContain(".standards/pending.json");
    expect(prompt).toContain("0001-baseline.md (v1)");
    expect(prompt).toContain("## Validation");
    // No changelog body is embedded — bodies live only in changes[].content.
    expect(changes.length).toBeGreaterThan(0);
    for (const entry of changes) {
      expect(entry.content.trim().length).toBeGreaterThan(0);
      expect(prompt).not.toContain(entry.content.trim());
    }
  });

  it("instructs run 1 to post an information comment for failed or incomplete checks", async () => {
    const { buildPrompt } = await import("../src/agent.js");
    const { selectChanges } = await import("../src/changes.js");
    const { getPackageRoot } = await import("../src/manifest.js");
    const root = getPackageRoot();

    const prompt = buildPrompt({
      packageRoot: root,
      meta: { standards: 1, visibility: "oss", since: 2020 },
      scopeNames: ["common", "node"],
      fromVersion: 0,
      toVersion: 2,
      changes: selectChanges(root, 0, ["common", "node"]),
    });

    expect(prompt).toContain("information comment");
    expect(prompt).toContain("could not complete");
    // Context-bound anchor for the env-prerequisites note (unique to this bullet).
    expect(prompt).toContain("may lack prerequisites");
    expect(prompt).toContain("environment variables");
    // Conditional: no comment when everything passes.
    expect(prompt).toContain("post no such comment");
    // The distinguishing clauses vs. #38: additive and finalize-preserving.
    expect(prompt).toContain("in addition to the summary");
    expect(prompt).toContain("always-finalize");
  });
});

function hashTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const handler = entry.isDirectory()
        ? walk
        : (path: string): void => {
            hashes.set(
              relative(root, path),
              createHash("sha256").update(readFileSync(path)).digest("hex"),
            );
          };
      handler(full);
    }
  };
  walk(root);
  return hashes;
}

function readStamp(cwd: string): number {
  const raw: unknown = JSON.parse(readFileSync(join(cwd, ".repometa.json"), "utf8"));
  if (typeof raw !== "object" || raw === null || !("standards" in raw)) {
    throw new Error("invalid .repometa.json");
  }
  const value = (raw as Record<string, unknown>).standards;
  if (typeof value !== "number") {
    throw new TypeError("standards is not a number");
  }
  return value;
}

function unwrap<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("expected defined value");
  }
  return value;
}

const CONTRACT_PREFIXES = [
  ".oxfmtrc.json",
  "eslint.config.ts",
  "oxlint.config.ts",
  "tsconfig.json",
  "cspell.json",
  "renovate.json",
  ".repometa.json",
  "README.md",
  "AGENTS.md",
  ".standards/",
  ".github/",
];

function withinContract(path: string): boolean {
  return CONTRACT_PREFIXES.some(
    (prefix) => path === prefix || (prefix.endsWith("/") && path.startsWith(prefix)),
  );
}

describe("buildPendingPayload", () => {
  it("emits a schema-versioned payload when changes are pending", () => {
    const cwd = createFixtureRepo();
    const payload = unwrap(buildPendingPayload(cwd, 0));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      fromVersion: 0,
      visibility: "oss",
      exceptions: [],
    });
    expect(payload.toVersion).toBeGreaterThanOrEqual(2);
    expect(payload.scopes).toContain("common");
    expect(payload.scopes).toContain("node");
    expect(payload.prompt).toContain("repository standards — agent instructions");
    expect(payload.changes.length).toBeGreaterThan(0);
    expect(payload.changes.every((entry) => typeof entry.content === "string")).toBe(true);
    // The prompt references the changes array; it does not duplicate the
    // changelog bodies, which live only in changes[].content.
    expect(payload.prompt).toContain(".standards/pending.json");
    for (const entry of payload.changes) {
      expect(entry.content.trim().length).toBeGreaterThan(0);
      expect(payload.prompt).not.toContain(entry.content.trim());
    }
  });

  it("returns undefined when the stamp matches the manifest", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);
    const stamp = readStamp(cwd);
    expect(stamp).toBeGreaterThanOrEqual(2);
    expect(buildPendingPayload(cwd, stamp)).toBeUndefined();
  });

  it("uses explicit fromVersion even when .repometa.json was already bumped", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);

    const payload = unwrap(buildPendingPayload(cwd, 0));
    expect(payload.fromVersion).toBe(0);
    expect(payload.changes.length).toBeGreaterThan(0);
  });
});

describe("assertPendingPayload", () => {
  const validPayload = {
    schemaVersion: 1,
    fromVersion: 0,
    toVersion: 2,
    scopes: ["common", "node"],
    visibility: "oss",
    exceptions: [],
    prompt: "prompt body",
    changes: [
      {
        file: "0001-baseline.md",
        version: 1,
        scopes: ["common", "node"],
        content: "changelog body",
      },
    ],
  };

  it("accepts a payload built by buildPendingPayload after a structured clone", () => {
    const cwd = createFixtureRepo();
    const payload = unwrap(buildPendingPayload(cwd, 0));
    const clone: unknown = structuredClone(payload);
    expect(() => {
      assertPendingPayload(clone);
    }).not.toThrow();
  });

  it("accepts a manually constructed valid payload with empty changes", () => {
    const empty = { ...validPayload, changes: [] };
    expect(() => {
      assertPendingPayload(empty);
    }).not.toThrow();
  });

  it("rejects a payload with the wrong schemaVersion", () => {
    const bad = { ...validPayload, schemaVersion: 2 };
    expect(() => {
      assertPendingPayload(bad);
    }).toThrow(/schemaVersion/);
  });

  it("rejects a payload with a missing required field", () => {
    const { fromVersion, ...rest } = validPayload;
    void fromVersion;
    expect(() => {
      assertPendingPayload(rest);
    }).toThrow(/fromVersion/);
  });

  it("rejects a payload where scopes is not an array of strings", () => {
    const bad = { ...validPayload, scopes: "common" };
    expect(() => {
      assertPendingPayload(bad);
    }).toThrow(/scopes/);
  });

  it("rejects a payload with an unknown visibility value", () => {
    const bad = { ...validPayload, visibility: "internal" };
    expect(() => {
      assertPendingPayload(bad);
    }).toThrow(/visibility/);
  });

  it("rejects a payload with a malformed changes entry", () => {
    const bad = {
      ...validPayload,
      changes: [{ file: "x.md", version: 1, scopes: ["common"] }],
    };
    expect(() => {
      assertPendingPayload(bad);
    }).toThrow(/changes\[0\]\.content/);
  });
});

describe("writePending", () => {
  it("writes the schema-versioned marker at the resolved path", () => {
    const cwd = createFixtureRepo();
    const payload = buildPendingPayload(cwd, 0);
    writePending(cwd, ".standards/pending.json", payload);

    const path = join(cwd, ".standards/pending.json");
    expect(existsSync(path)).toBe(true);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toMatchObject({ schemaVersion: 1, fromVersion: 0 });
  });

  it("removes a stale marker when no payload is pending", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);
    const path = join(cwd, ".standards/pending.json");
    mkdirSync(join(cwd, ".standards"), { recursive: true });
    writeFileSync(path, "{}\n", "utf8");

    writePending(cwd, ".standards/pending.json", undefined);

    expect(existsSync(path)).toBe(false);
  });

  it("is a no-op when no payload is pending and no marker exists", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);
    const path = join(cwd, ".standards/pending.json");

    writePending(cwd, ".standards/pending.json", undefined);

    expect(existsSync(path)).toBe(false);
  });
});

describe("preReadMeta threading", () => {
  it("runApply with and without preReadMeta produces identical changes", () => {
    const cwdA = createFixtureRepo();
    const cwdB = createFixtureRepo();
    const meta = {
      standards: 0,
      visibility: "oss" as const,
      since: 2020,
      platform: "github" as const,
    };

    const changesDefault = runApply(cwdA, YEAR);
    const changesParameterized = runApply(cwdB, YEAR, meta);

    expect(
      changesParameterized.map((change) => change.path).sort((a, b) => a.localeCompare(b)),
    ).toStrictEqual(changesDefault.map((change) => change.path).sort((a, b) => a.localeCompare(b)));
  });

  it("buildPendingPayload with and without preReadMeta produces identical payloads", () => {
    const cwd = createFixtureRepo();
    const meta = {
      standards: 0,
      visibility: "oss" as const,
      since: 2020,
      platform: "github" as const,
    };

    const payloadWithoutMeta = unwrap(buildPendingPayload(cwd, 0));
    const payloadWithMeta = unwrap(buildPendingPayload(cwd, 0, meta));

    expect(payloadWithMeta).toStrictEqual(payloadWithoutMeta);
  });
});

describe("apply write contract", () => {
  it("modifies only contract-allowed paths", () => {
    const cwd = createFixtureRepo();

    const foreign = ["src/x.ts", ".gitignore", "docs/notes.md"];
    foreign.forEach((rel) => {
      const target = join(cwd, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, `foreign:${rel}\n`);
    });

    const before = hashTree(cwd);
    runApply(cwd, YEAR);
    const after = hashTree(cwd);

    const modifiedPaths = [...after.entries()]
      .filter(([path, hash]) => before.get(path) !== hash)
      .map(([path]) => path);
    const removedPaths = [...before.keys()].filter((path) => !after.has(path));
    const violators = [...modifiedPaths, ...removedPaths].filter((path) => !withinContract(path));
    expect(violators).toStrictEqual([]);

    const preservedForeign = foreign.map((rel) => readFileSync(join(cwd, rel), "utf8"));
    expect(preservedForeign).toStrictEqual(foreign.map((rel) => `foreign:${rel}\n`));
  });
});

function createFreshDir(): string {
  return mkdtempSync(join(tmpdir(), "standards-init-"));
}

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(" ")} failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`git ${args.join(" ")} exited with status ${String(result.status)}: ${stderr}`);
  }
}

function initGitRepo(cwd: string, commitYear: number): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_AUTHOR_DATE: `${String(commitYear)}-01-15T12:00:00`,
    GIT_COMMITTER_DATE: `${String(commitYear)}-01-15T12:00:00`,
  };
  runGit(cwd, ["init", "--quiet", "--initial-branch=main"], env);
  writeFileSync(join(cwd, "README.md"), "# fixture\n");
  runGit(cwd, ["add", "README.md"], env);
  runGit(cwd, ["commit", "--quiet", "-m", "initial"], env);
}

describe("parseVisibilityFlag", () => {
  it("accepts the two long forms", () => {
    expect(parseVisibilityFlag("oss")).toBe("oss");
    expect(parseVisibilityFlag("private")).toBe("private");
  });

  it("rejects short forms and anything else", () => {
    expect(() => parseVisibilityFlag("o")).toThrow(InitError);
    expect(() => parseVisibilityFlag("p")).toThrow(InitError);
    expect(() => parseVisibilityFlag("internal")).toThrow(InitError);
    expect(() => parseVisibilityFlag("")).toThrow(InitError);
  });
});

describe("parseVisibilityChoice", () => {
  it("accepts short and long forms case-insensitive and trimmed", () => {
    expect(parseVisibilityChoice("o")).toBe("oss");
    expect(parseVisibilityChoice("O")).toBe("oss");
    expect(parseVisibilityChoice("oss")).toBe("oss");
    expect(parseVisibilityChoice("OSS")).toBe("oss");
    expect(parseVisibilityChoice(" oss ")).toBe("oss");
    expect(parseVisibilityChoice("p")).toBe("private");
    expect(parseVisibilityChoice("private")).toBe("private");
  });

  it("returns undefined for unrelated input", () => {
    expect(parseVisibilityChoice("internal")).toBeUndefined();
    expect(parseVisibilityChoice("1")).toBeUndefined();
    expect(parseVisibilityChoice("yes")).toBeUndefined();
  });
});

describe("parseSinceFlag", () => {
  it("accepts a valid year and the inclusive currentYear+1 upper bound", () => {
    expect(parseSinceFlag("2020", YEAR)).toBe(2020);
    expect(parseSinceFlag("2026", YEAR)).toBe(2026);
    expect(parseSinceFlag(String(YEAR + 1), YEAR)).toBe(YEAR + 1);
  });

  it("rejects non-integer, out-of-range, leading-zero, and current+2 years", () => {
    expect(() => parseSinceFlag("abc", YEAR)).toThrow(InitError);
    expect(() => parseSinceFlag("1999", YEAR)).toThrow(InitError);
    expect(() => parseSinceFlag("99999", YEAR)).toThrow(InitError);
    expect(() => parseSinceFlag(String(YEAR + 2), YEAR)).toThrow(InitError);
    expect(() => parseSinceFlag("0000", YEAR)).toThrow(InitError);
    expect(() => parseSinceFlag("02020", YEAR)).toThrow(InitError);
  });

  it("prefixes prompt-style errors with --since for flag callers", () => {
    expect(() => parseSinceFlag("1999", YEAR)).toThrow(/^--since: /);
  });
});

describe("parsePlatformFlag", () => {
  it("accepts the two long forms", () => {
    expect(parsePlatformFlag("github")).toBe("github");
    expect(parsePlatformFlag("forgejo")).toBe("forgejo");
  });

  it("rejects short forms and unknown values", () => {
    expect(() => parsePlatformFlag("g")).toThrow(InitError);
    expect(() => parsePlatformFlag("f")).toThrow(InitError);
    expect(() => parsePlatformFlag("gitlab")).toThrow(InitError);
    expect(() => parsePlatformFlag("")).toThrow(InitError);
  });
});

describe("parsePlatformChoice", () => {
  it("accepts short and long forms case-insensitive and trimmed", () => {
    expect(parsePlatformChoice("g")).toBe("github");
    expect(parsePlatformChoice("G")).toBe("github");
    expect(parsePlatformChoice("github")).toBe("github");
    expect(parsePlatformChoice("GITHUB")).toBe("github");
    expect(parsePlatformChoice(" github ")).toBe("github");
    expect(parsePlatformChoice("f")).toBe("forgejo");
    expect(parsePlatformChoice("forgejo")).toBe("forgejo");
  });

  it("returns undefined for unrelated input", () => {
    expect(parsePlatformChoice("gitlab")).toBeUndefined();
    expect(parsePlatformChoice("1")).toBeUndefined();
  });
});

describe("detectPlatform", () => {
  it("returns forgejo for a non-git directory", () => {
    const cwd = createFreshDir();
    expect(detectPlatform(cwd)).toBe("forgejo");
  });

  it("returns github when origin URL contains github.com", () => {
    const cwd = createFreshDir();
    spawnSync("git", ["-C", cwd, "init", "--quiet", "--initial-branch=main"]);
    spawnSync("git", [
      "-C",
      cwd,
      "remote",
      "add",
      "origin",
      "https://github.com/example/example.git",
    ]);
    expect(detectPlatform(cwd)).toBe("github");
  });

  it("returns forgejo for any other origin URL", () => {
    const cwd = createFreshDir();
    spawnSync("git", ["-C", cwd, "init", "--quiet", "--initial-branch=main"]);
    spawnSync("git", [
      "-C",
      cwd,
      "remote",
      "add",
      "origin",
      "https://forgejo.example.com/example/example.git",
    ]);
    expect(detectPlatform(cwd)).toBe("forgejo");
  });
});

function createPlatformFixture(platform: "forgejo" | "github" | undefined): string {
  const cwd = mkdtempSync(join(tmpdir(), "standards-platform-"));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  writeFileSync(join(cwd, "README.md"), "# Demo\n");
  const meta: Record<string, unknown> = { standards: 0, visibility: "oss", since: 2020 };
  if (platform !== undefined) meta.platform = platform;
  writeFileSync(join(cwd, ".repometa.json"), `${JSON.stringify(meta, undefined, 2)}\n`);
  return cwd;
}

describe("platform filter in runApply and runCheck", () => {
  const githubCiPath = ".github/workflows/ci.yml";
  const forgejoCiPath = ".forgejo/workflows/ci.yml";

  it("writes the github-scoped CI workflow on a github repo", () => {
    const cwd = createPlatformFixture("github");
    runApply(cwd, YEAR);
    expect(existsSync(join(cwd, githubCiPath))).toBe(true);
    expect(existsSync(join(cwd, forgejoCiPath))).toBe(false);
  });

  it("writes the forgejo-scoped CI workflow on a forgejo repo", () => {
    const cwd = createPlatformFixture("forgejo");
    runApply(cwd, YEAR);
    expect(existsSync(join(cwd, forgejoCiPath))).toBe(true);
    expect(existsSync(join(cwd, githubCiPath))).toBe(false);
  });

  it("skips every platform-scoped entry on a legacy repo and refuses to bump the stamp", () => {
    const cwd = createPlatformFixture(undefined);
    const changes = runApply(cwd, YEAR);
    expect(existsSync(join(cwd, githubCiPath))).toBe(false);
    expect(existsSync(join(cwd, forgejoCiPath))).toBe(false);
    expect(changes.find((change) => change.path === ".repometa.json")).toBeUndefined();
    expect(readStamp(cwd)).toBe(0);
  });

  it("reports no drift for filtered-out entries on a forgejo repo", () => {
    const cwd = createPlatformFixture("forgejo");
    runApply(cwd, YEAR);
    const findings = runCheck(cwd, YEAR);
    expect(findings.find((f) => f.path === githubCiPath)).toBeUndefined();
    expect(findings.find((f) => f.path === forgejoCiPath)).toBeUndefined();
  });

  it("reports no drift for filtered-out entries on a github repo", () => {
    const cwd = createPlatformFixture("github");
    runApply(cwd, YEAR);
    const findings = runCheck(cwd, YEAR);
    expect(findings.find((f) => f.path === githubCiPath)).toBeUndefined();
    expect(findings.find((f) => f.path === forgejoCiPath)).toBeUndefined();
  });

  it("reports a stamp finding for legacy repos missing platform when platform-scoped entries exist", () => {
    const cwd = createPlatformFixture(undefined);
    const findings = runCheck(cwd, YEAR);
    const missing = findings.find((f) => f.detail.includes("platform is missing"));
    expect(missing).toBeDefined();
  });
});

describe("matchesPlatform", () => {
  it("entries without platform apply to every repo", () => {
    expect(matchesPlatform(undefined, "github")).toBe(true);
    expect(matchesPlatform(undefined, "forgejo")).toBe(true);
    expect(matchesPlatform(undefined, undefined)).toBe(true);
  });

  it("matching platforms apply", () => {
    expect(matchesPlatform("github", "github")).toBe(true);
    expect(matchesPlatform("forgejo", "forgejo")).toBe(true);
  });

  it("mismatched platforms are skipped", () => {
    expect(matchesPlatform("github", "forgejo")).toBe(false);
    expect(matchesPlatform("forgejo", "github")).toBe(false);
  });

  it("legacy meta (no platform) skips every platform-scoped entry", () => {
    expect(matchesPlatform("github", undefined)).toBe(false);
    expect(matchesPlatform("forgejo", undefined)).toBe(false);
  });
});

describe("detectFirstCommitYear", () => {
  it("returns undefined for a non-git directory", () => {
    const cwd = createFreshDir();
    expect(detectFirstCommitYear(cwd, YEAR)).toBeUndefined();
  });

  it("returns the root-commit year for a backdated repo", () => {
    const cwd = createFreshDir();
    initGitRepo(cwd, 2020);
    expect(detectFirstCommitYear(cwd, YEAR)).toBe(2020);
  });

  it("returns undefined when the repo has no commits", () => {
    const cwd = createFreshDir();
    spawnSync("git", ["-C", cwd, "init", "--quiet", "--initial-branch=main"]);
    expect(detectFirstCommitYear(cwd, YEAR)).toBeUndefined();
  });
});

describe("runInit", () => {
  it("writes a complete schema with all options provided", async () => {
    const cwd = createFreshDir();
    const meta = await runInit(cwd, YEAR, {
      visibility: "private",
      since: 2024,
      platform: "github",
      interactive: false,
    });
    expect(meta).toStrictEqual({
      standards: 0,
      visibility: "private",
      since: 2024,
      platform: "github",
    });

    const onDisk: unknown = JSON.parse(readFileSync(join(cwd, ".repometa.json"), "utf8"));
    expect(onDisk).toStrictEqual(meta);
  });

  it("applies defaults when no options are passed and cwd is non-git", async () => {
    const cwd = createFreshDir();
    const meta = await runInit(cwd, YEAR, { interactive: false });
    expect(meta).toStrictEqual({
      standards: 0,
      visibility: "oss",
      since: YEAR,
      platform: "forgejo",
    });
  });

  it("uses the git root-commit year for the since default", async () => {
    const cwd = createFreshDir();
    initGitRepo(cwd, 2020);
    const meta = await runInit(cwd, YEAR, { interactive: false });
    expect(meta.since).toBe(2020);
  });

  it("detects platform from origin URL in non-interactive mode", async () => {
    const cwd = createFreshDir();
    spawnSync("git", ["-C", cwd, "init", "--quiet", "--initial-branch=main"]);
    spawnSync("git", [
      "-C",
      cwd,
      "remote",
      "add",
      "origin",
      "https://github.com/example/example.git",
    ]);
    const meta = await runInit(cwd, YEAR, { interactive: false });
    expect(meta.platform).toBe("github");
  });

  it("refuses to overwrite an existing file without force", async () => {
    const cwd = createFreshDir();
    writeFileSync(join(cwd, ".repometa.json"), "{}\n");
    await expect(runInit(cwd, YEAR, { interactive: false })).rejects.toThrow(/already exists/);
    await expect(runInit(cwd, YEAR, { interactive: false })).rejects.toThrow(/--force/);
  });

  it("overwrites when force is set", async () => {
    const cwd = createFreshDir();
    writeFileSync(
      join(cwd, ".repometa.json"),
      `${JSON.stringify({ standards: 2, visibility: "oss", since: 2024 }, undefined, 2)}\n`,
    );
    const meta = await runInit(cwd, YEAR, { interactive: false, force: true });
    expect(meta.standards).toBe(0);
  });
});

type CapturedRun = {
  input: PassThrough;
  output: Writable;
  captured: { current: string };
};

function createCapturedStreams(): CapturedRun {
  const captured = { current: "" };
  const output = new Writable({
    write(chunk, _encoding, callback) {
      captured.current += String(chunk);
      callback();
    },
  });
  return { input: new PassThrough(), output, captured };
}

async function feedInput(input: PassThrough, lines: string[]): Promise<void> {
  for (const line of lines) {
    input.write(`${line}\n`);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

describe("runInit interactive prompt loop", () => {
  it("accepts single-letter shortcuts and returns the parsed values", async () => {
    const cwd = createFreshDir();
    const { input, output, captured } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["p", "2018", "g"]);

    const meta = await initPromise;
    expect(meta).toStrictEqual({
      standards: 0,
      visibility: "private",
      since: 2018,
      platform: "github",
    });
    expect(captured.current).toContain("Repository visibility");
    expect(captured.current).toContain("(o) open source");
    expect(captured.current).toContain("Repository platform");
    expect(captured.current).toContain("(g) GitHub");
  });

  it("applies defaults on empty input", async () => {
    const cwd = createFreshDir();
    const { input, output } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["", "", ""]);

    const meta = await initPromise;
    expect(meta).toStrictEqual({
      standards: 0,
      visibility: "oss",
      since: YEAR,
      platform: "forgejo",
    });
  });

  it("re-prompts after invalid visibility, then accepts a valid value", async () => {
    const cwd = createFreshDir();
    const { input, output, captured } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
      platform: "github",
    });
    void feedInput(input, ["x", "oss", "2020"]);

    const meta = await initPromise;
    expect(meta.visibility).toBe("oss");
    expect(captured.current).toContain("Please answer o, p, oss, or private.");
  });

  it("re-prompts after invalid year, then accepts a valid value", async () => {
    const cwd = createFreshDir();
    const { input, output, captured } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
      platform: "github",
    });
    void feedInput(input, ["o", "1999", "2020"]);

    const meta = await initPromise;
    expect(meta.since).toBe(2020);
    expect(captured.current).toContain("Year must be");
    expect(captured.current).not.toContain("--since");
  });

  it("aborts after 3 invalid visibility attempts", async () => {
    const cwd = createFreshDir();
    const { input, output } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["x", "y", "z"]);

    await expect(initPromise).rejects.toThrow(/Too many invalid attempts for visibility/);
  });

  it("aborts after 3 invalid year attempts", async () => {
    const cwd = createFreshDir();
    const { input, output } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["o", "abc", "1999", "99999"]);

    await expect(initPromise).rejects.toThrow(/Too many invalid attempts for initial year/);
  });

  it("aborts after 3 invalid platform attempts", async () => {
    const cwd = createFreshDir();
    const { input, output } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["o", "2020", "x", "y", "z"]);

    await expect(initPromise).rejects.toThrow(/Too many invalid attempts for platform/);
  });
});

describe("runInit write contract", () => {
  it("modifies only .repometa.json", async () => {
    const cwd = createFreshDir();
    const foreign = ["src/x.ts", ".gitignore", "docs/notes.md"];
    foreign.forEach((rel) => {
      const target = join(cwd, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, `foreign:${rel}\n`);
    });

    const before = hashTree(cwd);
    await runInit(cwd, YEAR, { interactive: false });
    const after = hashTree(cwd);

    const modifiedPaths = [...after.entries()]
      .filter(([path, hash]) => before.get(path) !== hash)
      .map(([path]) => path);
    const removedPaths = [...before.keys()].filter((path) => !after.has(path));
    expect([...modifiedPaths, ...removedPaths]).toStrictEqual([".repometa.json"]);

    const preservedForeign = foreign.map((rel) => readFileSync(join(cwd, rel), "utf8"));
    expect(preservedForeign).toStrictEqual(foreign.map((rel) => `foreign:${rel}\n`));
  });
});

describe("initCommand TTY injection", () => {
  it("throws on non-TTY without --yes", async () => {
    const cwd = createFreshDir();
    await expect(initCommand({ cwd, currentYear: YEAR, args: [], isTty: false })).rejects.toThrow(
      /No TTY/,
    );
  });

  it("writes the file in non-interactive mode with --yes regardless of TTY", async () => {
    const cwd = createFreshDir();
    await initCommand({
      cwd,
      currentYear: YEAR,
      args: ["--yes", "--visibility", "private", "--since", "2024"],
      isTty: false,
    });
    expect(existsSync(join(cwd, ".repometa.json"))).toBe(true);
    expect(readStamp(cwd)).toBe(0);
  });
});

describe("published binary", () => {
  it("bin wrapper starts with a node shebang", async () => {
    const { getPackageRoot } = await import("../src/manifest.js");
    const wrapper = readFileSync(join(getPackageRoot(), "bin/standards.js"), "utf8");
    expect(wrapper.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});

describe("standards init CLI guard", () => {
  it("fails fast with a No TTY hint when stdin is piped and --yes is absent", async () => {
    const { getPackageRoot } = await import("../src/manifest.js");
    const cliPath = join(getPackageRoot(), "dist", "cli.js");
    const fixtureCwd = mkdtempSync(join(tmpdir(), "standards-cli-"));

    const result = spawnSync(process.execPath, [cliPath, "init", "--cwd", fixtureCwd], {
      encoding: "utf8",
      input: "",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/No TTY/);
  });
});
