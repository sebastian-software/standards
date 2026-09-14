import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runApply } from "../src/apply.js";
import { getPackageRoot, loadManifest } from "../src/manifest.js";
import { readRepoMeta, writeRepoMeta } from "../src/repo.js";
import { buildPendingPayload, writePending } from "../src/sync.js";

const root = getPackageRoot();
const version = loadManifest(root).currentVersion;
const directories: string[] = [];
const marker = ".standards/pending.json";
const blocked = {
  schemaVersion: 1,
  blocking: true,
  reason: "Alignment failed",
  detectedAt: "2026-09-15T00:00:00Z",
  expectedStandardsVersion: version,
  observedStandardsVersion: version,
  expectedCliVersion: null,
  observedCliVersion: null,
  failedChecks: ["standards check"],
  retry: "Repair the CLI pin",
};

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function repository(nested = false): string {
  const cwd = mkdtempSync(join(tmpdir(), "standards-recovery-"));
  directories.push(cwd);
  const unit = nested ? join(cwd, "node") : cwd;
  mkdirSync(unit, { recursive: true });
  writeFileSync(
    join(unit, "package.json"),
    JSON.stringify({
      name: "consumer",
      devDependencies: { "@sebastian-software/standards": "0.12.0" },
    }),
  );
  writeFileSync(join(cwd, "README.md"), "# Consumer\n");
  writeRepoMeta(cwd, {
    standards: 13,
    visibility: "oss",
    since: 2026,
    platform: "github",
    ...(nested ? { workspaces: ["node"] } : {}),
  });
  return cwd;
}

function cli(cwd: string, command: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(root, "dist/cli.js"), command, "--cwd", cwd, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH ?? ""}` },
  });
}

function agent(cwd: string, script: string): void {
  mkdirSync(join(cwd, "bin"), { recursive: true });
  const path = join(cwd, "bin/codex");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

function files(cwd: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(cwd, { recursive: true, encoding: "utf8" })
      .filter((file) => statSync(join(cwd, file)).isFile())
      .map((file) => [file, readFileSync(join(cwd, file), "utf8")]),
  );
}

describe("local sync recovery", () => {
  it("previews nested migration steps without changing any files", () => {
    const cwd = repository(true);
    const before = files(cwd);
    const result = cli(cwd, "sync", ["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0014-exact-pin-shape.md");
    expect(result.stdout).toContain("0015-ci-and-standards-check-names.md");
    expect(files(cwd)).toStrictEqual(before);
  });

  it("resumes the original baseline after an agent removes the marker and fails", () => {
    const cwd = repository();
    agent(cwd, "rm .standards/pending.json\nexit 7");
    expect(cli(cwd, "sync", ["--agent", "codex"]).status).toBe(7);
    expect(readRepoMeta(cwd).standards).toBe(version);
    expect(JSON.parse(readFileSync(join(cwd, marker), "utf8"))).toMatchObject({
      fromVersion: 13,
      toVersion: version,
    });
    agent(cwd, "cp .standards/pending.json received.json\nexit 0");
    expect(cli(cwd, "sync", ["--agent", "codex"]).status).toBe(0);
    expect(readFileSync(join(cwd, "received.json"), "utf8")).toContain("0014-exact-pin-shape.md");
    expect(files(cwd)).not.toHaveProperty(marker);
  });

  it("retains pending work when a successful agent leaves an invalid pin", () => {
    const cwd = repository();
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { "@sebastian-software/standards": "^0.12.0" } }),
    );
    agent(cwd, "exit 0");
    expect(cli(cwd, "sync", ["--agent", "codex"]).status).toBe(3);
    expect(files(cwd)).toHaveProperty(marker);
  });

  it("preserves an unreadable pending payload instead of replacing its baseline", () => {
    const cwd = repository();
    mkdirSync(join(cwd, ".standards"));
    writeFileSync(join(cwd, marker), "broken JSON");
    const before = files(cwd);
    expect(cli(cwd, "sync", ["--dry-run"]).status).toBe(1);
    expect(files(cwd)).toStrictEqual(before);
  });

  it("keeps pending work when the agent cannot start", () => {
    const cwd = repository();
    const result = spawnSync(
      process.execPath,
      [join(root, "dist/cli.js"), "sync", "--cwd", cwd, "--agent", "codex"],
      { encoding: "utf8", env: { ...process.env, PATH: join(cwd, "empty-bin") } },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not start codex");
    expect(JSON.parse(readFileSync(join(cwd, marker), "utf8"))).toMatchObject({ fromVersion: 13 });
  });

  it("keeps the baseline when mechanical application fails", () => {
    const cwd = repository();
    writeRepoMeta(cwd, { ...readRepoMeta(cwd), readme: { owner: "mdtheme" } });
    agent(cwd, "exit 0");
    expect(cli(cwd, "sync", ["--agent", "codex"]).status).toBe(1);
    expect(JSON.parse(readFileSync(join(cwd, marker), "utf8"))).toMatchObject({ fromVersion: 13 });
    expect(readRepoMeta(cwd).standards).toBe(13);
  });
});

describe("shared CI entry point", () => {
  function currentRepository(): string {
    const cwd = repository();
    runApply(cwd, 2026);
    return cwd;
  }

  it("accepts a current consumer", () => {
    expect(cli(currentRepository(), "ci").status).toBe(0);
  });

  it("rejects a pending migration while the ordinary check can inspect it", () => {
    const cwd = currentRepository();
    writePending(cwd, marker, buildPendingPayload(cwd, 13));
    expect(cli(cwd, "check").status).toBe(0);
    expect(cli(cwd, "ci").status).toBe(1);
  });

  it.each([
    ["blocking", JSON.stringify(blocked), 1],
    ["non-blocking", JSON.stringify({ ...blocked, blocking: false }), 0],
    ["malformed JSON", "broken", 1],
    ["invalid schema", JSON.stringify({ blocking: false }), 1],
    ["array", "[]", 1],
    ["split flag", JSON.stringify(blocked).replace('"blocking":true', '"blocking":\ntrue'), 1],
  ])("handles a %s marker", (_label, content, status) => {
    const cwd = currentRepository();
    mkdirSync(join(cwd, ".standards"));
    writeFileSync(join(cwd, ".standards/blocked.json"), content);
    expect(cli(cwd, "ci").status).toBe(status);
  });

  it("uses the ordinary exact-pin and stamp checks", () => {
    const cwd = currentRepository();
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { "@sebastian-software/standards": "^0.12.0" } }),
    );
    expect(cli(cwd, "ci").status).toBe(3);
    writeRepoMeta(cwd, { ...readRepoMeta(cwd), standards: version + 1 });
    expect(cli(cwd, "ci").status).toBe(3);
  });

  it.each([
    "reference/node/github-workflows-ci.yml",
    "reference/node/forgejo-workflows-ci.yml",
    "reference/rust/ci.yml",
  ])("%s calls the shared implementation", (path) => {
    const workflow = readFileSync(join(root, path), "utf8");
    expect(workflow).toMatch(/standards[^ \n]* ci/u);
    expect(workflow).not.toContain("const broken =");
    expect(workflow).not.toContain("const exact =");
  });
});

describe("apply without ignore migration", () => {
  it("does not scan an unrelated unreadable directory", () => {
    const cwd = repository();
    const cache = join(cwd, "target");
    mkdirSync(cache);
    chmodSync(cache, 0);
    try {
      expect(() => runApply(cwd, 2026)).not.toThrow();
    } finally {
      chmodSync(cache, 0o700);
    }
  });
});
