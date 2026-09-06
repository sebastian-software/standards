import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { getPackageRoot } from "../src/manifest.js";

const ACTIONS_DIR = join(getPackageRoot(), ".github", "actions");
const ACTION_NAMES = ["check-action-pins", "napi-matrix", "publish-crates", "publish-npm"] as const;
const PIN_CHECKER = join(ACTIONS_DIR, "check-action-pins", "check-action-pins.mjs");
const NAPI_MATRIX = join(ACTIONS_DIR, "napi-matrix", "napi-matrix.mjs");

type PlatformEntry = {
  id: string;
  target: string;
  runner: string;
  os: string;
  cpu: string;
  libc: null | string;
  native: boolean;
  sidecar: string;
  artifact: string;
  binary: string;
};

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function workflowFixture(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "standards-pins-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "workflow.yml"), content, "utf8");
  return directory;
}

type CommandResult = { status: number; stderr: string; stdout: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function failureResult(error: unknown): CommandResult {
  if (!isRecord(error)) {
    throw error;
  }
  return {
    status: typeof error.status === "number" ? error.status : 1,
    stderr: typeof error.stderr === "string" ? error.stderr : "",
    stdout: typeof error.stdout === "string" ? error.stdout : "",
  };
}

function runPinChecker(target: string): CommandResult {
  try {
    const stdout = execFileSync(process.execPath, [PIN_CHECKER, target], { encoding: "utf8" });
    return { status: 0, stderr: "", stdout };
  } catch (error) {
    return failureResult(error);
  }
}

function assertPlatformEntries(value: unknown): asserts value is PlatformEntry[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => isRecord(entry) && typeof entry.id === "string")
  ) {
    throw new TypeError("napi-matrix did not emit a platform array");
  }
}

function runNapiMatrix(env: Record<string, string>): PlatformEntry[] {
  const stdout = execFileSync(process.execPath, [NAPI_MATRIX], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "", ...env },
  });
  const line = stdout.split("\n").find((entry) => entry.startsWith("matrix="));
  const parsed: unknown = JSON.parse((line ?? "").slice("matrix=".length));
  if (!isRecord(parsed)) {
    throw new TypeError("napi-matrix did not emit a matrix object");
  }
  const { include } = parsed;
  assertPlatformEntries(include);
  return include;
}

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("composite actions", () => {
  it.each(ACTION_NAMES)("%s ships an action.yml and a README section", (name) => {
    const action = readFileSync(join(ACTIONS_DIR, name, "action.yml"), "utf8");
    expect(action).toContain("using: composite");
    expect(readFileSync(join(ACTIONS_DIR, "README.md"), "utf8")).toContain(`## \`${name}\``);
  });

  it("pins every action it uses itself", () => {
    // The composite actions are consumed by SHA, so what they use has to be
    // pinned too — the pin rule does not stop at the repository boundary.
    expect(runPinChecker(ACTIONS_DIR).status).toBe(0);
  });
});

describe("check-action-pins", () => {
  it("accepts this repository's own workflows", () => {
    const result = runPinChecker(join(getPackageRoot(), ".github", "workflows"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts pinned block, flow, quoted, local and digest references", () => {
    const directory = workflowFixture(
      [
        "jobs:",
        "  build:",
        "    steps:",
        `      - uses: actions/checkout@${SHA} # v7.0.1`,
        `      - { uses: "actions/checkout@${SHA}", with: { ref: main } } # v7.0.1`,
        `      "uses": actions/checkout@${SHA} # v7.0.1`,
        "      - uses: ./.github/actions/local",
        `      - uses: docker://alpine@sha256:${"a".repeat(64)} # 3.21`,
        "",
      ].join("\n"),
    );

    expect(runPinChecker(directory).status).toBe(0);
  });

  it.each([
    ["a version tag", "      - uses: actions/checkout@v7", "full 40-character commit SHA"],
    [
      "a missing version comment",
      `      - uses: actions/checkout@${SHA}`,
      'missing the trailing "# <version>" comment',
    ],
    ["a docker image tag", "      - uses: docker://alpine:3.21", "immutable @sha256: digest"],
    [
      "an expression",
      // eslint-disable-next-line no-template-curly-in-string -- the fixture is workflow YAML, not a template literal
      "      - uses: ${{ github.repository }}/.github/workflows/ci.yml@main",
      "an expression is not a pin",
    ],
  ])("rejects %s", (_name, line, detail) => {
    const result = runPinChecker(
      workflowFixture(["jobs:", "  build:", "    steps:", line, ""].join("\n")),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(detail);
  });

  it("reports a uses key it cannot classify instead of skipping it", () => {
    const result = runPinChecker(
      workflowFixture(["jobs:", "  build:", "    steps:", "      - uses:", ""].join("\n")),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not be read");
  });
});

describe("napi-matrix", () => {
  it("derives sidecar, artifact and binary names for an unscoped package", () => {
    const entries = runNapiMatrix({ INPUT_PACKAGE: "my-product" });

    expect(entries.map((entry) => entry.id)).toStrictEqual([
      "linux-x64-gnu",
      "linux-arm64-gnu",
      "linux-x64-musl",
      "linux-arm64-musl",
      "darwin-arm64",
      "darwin-x64",
      "win32-x64-msvc",
      "win32-arm64-msvc",
    ]);
    expect(entries[4]).toMatchObject({
      artifact: "native-darwin-arm64",
      binary: "my-product.darwin-arm64.node",
      cpu: "arm64",
      os: "darwin",
      sidecar: "my-product-darwin-arm64",
      target: "aarch64-apple-darwin",
    });
  });

  it("keeps a scoped package's sidecars in its scope (decision D7)", () => {
    const entries = runNapiMatrix({
      INPUT_PACKAGE: "@acme/tool",
      INPUT_PLATFORMS: "darwin-arm64",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      binary: "tool.darwin-arm64.node",
      sidecar: "@acme/tool-darwin-arm64",
    });
  });

  it("documents every platform it ships", () => {
    const readme = readFileSync(join(ACTIONS_DIR, "README.md"), "utf8");

    for (const entry of runNapiMatrix({ INPUT_PACKAGE: "my-product" })) {
      expect(readme).toContain(`\`${entry.id}\``);
      expect(readme).toContain(`\`${entry.target}\``);
    }
  });
});
