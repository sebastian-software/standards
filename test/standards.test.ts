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
import {
  detectFirstCommitYear,
  InitError,
  parseSinceFlag,
  parseVisibilityChoice,
  parseVisibilityFlag,
  runInit,
} from "../src/init.js";
import { assertPendingPayload, buildPendingPayload, writePending } from "../src/sync.js";

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
    expect(result.content).toContain("<!-- m:start -->\nbody\n<!-- m:end -->");
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
    `${JSON.stringify({ standards: 0, visibility: "oss", since: 2020 }, undefined, 2)}\n`,
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
    expect(paths).toContain(".repometa.json");

    const readme = readFileSync(join(cwd, "README.md"), "utf8");
    expect(readme).toContain("sebastian-software-branding:start");
    expect(readme).toContain("2020&ndash;2026");

    expect(runCheck(cwd, YEAR)).toStrictEqual([]);

    writeFileSync(join(cwd, ".oxfmtrc.json"), "{}\n");
    const findings = runCheck(cwd, YEAR);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("managed");

    const repaired = runApply(cwd, YEAR);
    expect(repaired).toHaveLength(1);
    expect(runCheck(cwd, YEAR)).toStrictEqual([]);
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

    expect(selectChanges(root, 0, ["common"]).map((entry) => entry.version)).toStrictEqual([1, 2]);
    expect(selectChanges(root, 1, ["common", "node"]).map((entry) => entry.version)).toStrictEqual([
      2,
    ]);
    expect(selectChanges(root, 2, ["common", "node"])).toHaveLength(0);
    expect(selectChanges(root, 0, ["rust"])).toHaveLength(0);
  });

  it("builds an agent prompt containing skill and changelog", async () => {
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

    expect(prompt).toContain("repository standards — agent instructions");
    expect(prompt).toContain("0001-baseline.md");
    expect(prompt).toContain("0002-renovate-pending.md");
    expect(prompt).toContain("visibility: oss");
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
  ".oxfmtignore",
  "eslint.config.ts",
  "oxlint.config.ts",
  "tsconfig.json",
  "cspell.json",
  "renovate.json",
  ".repometa.json",
  "README.md",
  ".standards/",
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
    writePending(cwd, ".standards/pending.json", 0);

    const path = join(cwd, ".standards/pending.json");
    expect(existsSync(path)).toBe(true);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toMatchObject({ schemaVersion: 1, fromVersion: 0 });
  });

  it("removes a stale marker when no changes are pending", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);
    const stamp = readStamp(cwd);
    const path = join(cwd, ".standards/pending.json");
    mkdirSync(join(cwd, ".standards"), { recursive: true });
    writeFileSync(path, "{}\n", "utf8");

    writePending(cwd, ".standards/pending.json", stamp);

    expect(existsSync(path)).toBe(false);
  });

  it("is a no-op when no changes are pending and no marker exists", () => {
    const cwd = createFixtureRepo();
    runApply(cwd, YEAR);
    const stamp = readStamp(cwd);
    const path = join(cwd, ".standards/pending.json");

    writePending(cwd, ".standards/pending.json", stamp);

    expect(existsSync(path)).toBe(false);
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
      interactive: false,
    });
    expect(meta).toStrictEqual({ standards: 0, visibility: "private", since: 2024 });

    const onDisk: unknown = JSON.parse(readFileSync(join(cwd, ".repometa.json"), "utf8"));
    expect(onDisk).toStrictEqual(meta);
  });

  it("applies defaults when no options are passed and cwd is non-git", async () => {
    const cwd = createFreshDir();
    const meta = await runInit(cwd, YEAR, { interactive: false });
    expect(meta).toStrictEqual({ standards: 0, visibility: "oss", since: YEAR });
  });

  it("uses the git root-commit year for the since default", async () => {
    const cwd = createFreshDir();
    initGitRepo(cwd, 2020);
    const meta = await runInit(cwd, YEAR, { interactive: false });
    expect(meta.since).toBe(2020);
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
    void feedInput(input, ["p", "2018"]);

    const meta = await initPromise;
    expect(meta).toStrictEqual({ standards: 0, visibility: "private", since: 2018 });
    expect(captured.current).toContain("Repository visibility");
    expect(captured.current).toContain("(o) open source");
  });

  it("applies defaults on empty input", async () => {
    const cwd = createFreshDir();
    const { input, output } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
    });
    void feedInput(input, ["", ""]);

    const meta = await initPromise;
    expect(meta).toStrictEqual({ standards: 0, visibility: "oss", since: YEAR });
  });

  it("re-prompts after invalid visibility, then accepts a valid value", async () => {
    const cwd = createFreshDir();
    const { input, output, captured } = createCapturedStreams();
    const initPromise = runInit(cwd, YEAR, {
      interactive: true,
      streams: { input, output },
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
