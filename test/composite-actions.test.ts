import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// The `run:` body of a composite action's last step, indentation stripped so it can run
// under bash directly. The GitHub expressions live in the step's `env:` block,
// never in the body, so the body is ordinary shell.
function actionScript(name: string): string {
  const marker = "      run: |\n";
  const action = readFileSync(join(ACTIONS_DIR, name, "action.yml"), "utf8");
  const start = action.indexOf(marker);
  if (start === -1) {
    throw new Error(`${name}/action.yml has no run block`);
  }
  return action
    .slice(start + marker.length)
    .split("\n")
    .map((line) => {
      if (line.length === 0) {
        return line;
      }
      if (!line.startsWith("        ")) {
        throw new Error(`${name}/action.yml has content after its run block: ${line}`);
      }
      return line.slice(8);
    })
    .join("\n");
}

function scratchDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeStub(directory: string, name: string, body: string): void {
  const bin = join(directory, "bin");
  if (!existsSync(bin)) {
    mkdirSync(bin);
  }
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}`, "utf8");
  chmodSync(path, 0o755);
}

function runShell(script: string, cwd: string, env: Record<string, string>): CommandResult {
  const options = {
    cwd,
    encoding: "utf8" as const,
    env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH ?? ""}`, ...env },
  };
  try {
    return { status: 0, stderr: "", stdout: execFileSync("bash", ["-c", script], options) };
  } catch (error) {
    return failureResult(error);
  }
}

function logLines(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
    : [];
}

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

  it("ignores the word in a shell command or a comment", () => {
    // A `uses` key only exists at the start of a line or after `{`/`,` in a
    // flow mapping. Anywhere else the word is prose or shell, and reading it as
    // a step turned a passing repository red.
    const result = runPinChecker(
      workflowFixture(
        [
          "jobs:",
          "  build:",
          "    steps:",
          "      # uses: actions/checkout@v1 — a note about the step below",
          "      - run: grep 'uses:' .github/workflows/ci.yml",
          '      - run: echo "uses: actions/checkout@v1"',
          `      - uses: actions/checkout@${SHA} # v7.0.1`,
          "",
        ].join("\n"),
      ),
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 references");
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

describe("publish-crates script", () => {
  const script = actionScript("publish-crates");

  function crateFixture(options: { body?: string; httpCode?: string; publishExits?: string }): {
    cargoLog: string;
    cwd: string;
    curlLog: string;
    env: Record<string, string>;
  } {
    const cwd = scratchDirectory("standards-crates-");
    const cargoLog = join(cwd, "cargo.log");
    const curlLog = join(cwd, "curl.log");

    writeStub(
      cwd,
      "cargo",
      [
        'if [ "$1" = "pkgid" ]; then',
        '  echo "path+file:///workspace/$3@1.2.3"',
        "  exit 0",
        "fi",
        'echo "$*" >> "$CARGO_LOG"',
        'attempt="$(cat "$CWD/attempt" 2>/dev/null || echo 0)"',
        "attempt=$((attempt + 1))",
        'echo "$attempt" > "$CWD/attempt"',
        'exit "$(echo "$PUBLISH_EXITS" | cut -d, -f"$attempt")"',
        "",
      ].join("\n"),
    );
    writeStub(
      cwd,
      "curl",
      [
        'for argument in "$@"; do url="$argument"; done',
        'echo "$url" >> "$CURL_LOG"',
        '[ -n "$CURL_FAILS" ] && exit 7',
        `printf '%s\\n%s' "$INDEX_BODY" "$HTTP_CODE"`,
        "",
      ].join("\n"),
    );

    return {
      cargoLog,
      curlLog,
      cwd,
      env: {
        CARGO_LOG: cargoLog,
        CARGO_REGISTRY_TOKEN: "stub-token",
        CRATES: "my-product",
        CURL_LOG: curlLog,
        CWD: cwd,
        HTTP_CODE: options.httpCode ?? "200",
        INDEX_BODY: options.body ?? "",
        INDEX_TIMEOUT: "0",
        PUBLISH_EXITS: options.publishExits ?? "0,0",
        RETRY_DELAY: "0",
      },
    };
  }

  it("refuses to publish without credentials", () => {
    const fixture = crateFixture({ httpCode: "404" });
    const result = runShell(script, fixture.cwd, { ...fixture.env, CARGO_REGISTRY_TOKEN: "" });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("No crates.io credentials");
    expect(logLines(fixture.cargoLog)).toStrictEqual([]);
  });

  it("publishes a version the index does not have", () => {
    const fixture = crateFixture({ httpCode: "404" });

    expect(runShell(script, fixture.cwd, fixture.env).status).toBe(0);
    expect(logLines(fixture.cargoLog)).toStrictEqual(["publish -p my-product --locked"]);
  });

  it("skips a version the index already has", () => {
    const fixture = crateFixture({ body: '{"name":"my-product","vers":"1.2.3"}' });
    const result = runShell(script, fixture.cwd, fixture.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already on crates.io");
    expect(logLines(fixture.cargoLog)).toStrictEqual([]);
  });

  it("looks the index up under the lowercased crate name", () => {
    const fixture = crateFixture({ httpCode: "404" });
    runShell(script, fixture.cwd, { ...fixture.env, CRATES: "My-Product" });

    expect(logLines(fixture.curlLog)).toStrictEqual(["https://index.crates.io/my/-p/my-product"]);
  });

  it.each([
    ["a 5xx response", { httpCode: "503" }, {}],
    ["a transport failure", {}, { CURL_FAILS: "1" }],
  ])("fails instead of guessing after %s", (_name, options, extraEnvironment) => {
    const fixture = crateFixture(options);

    const result = runShell(script, fixture.cwd, { ...fixture.env, ...extraEnvironment });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("refusing to guess");
    // Nothing was published, so a rerun cannot hit "crate already exists".
    expect(logLines(fixture.cargoLog)).toStrictEqual([]);
  });

  it("retries a failed publish once", () => {
    const fixture = crateFixture({ httpCode: "404", publishExits: "1,0" });

    expect(runShell(script, fixture.cwd, fixture.env).status).toBe(0);
    expect(logLines(fixture.cargoLog)).toStrictEqual([
      "publish -p my-product --locked",
      "publish -p my-product --locked",
    ]);
  });
});

describe("publish-npm script", () => {
  const script = actionScript("publish-npm");

  function npmFixture(versions: Record<string, string>): {
    cwd: string;
    env: Record<string, string>;
    npmLog: string;
    output: string;
  } {
    const cwd = scratchDirectory("standards-npm-");
    const npmLog = join(cwd, "npm.log");
    const output = join(cwd, "github-output");

    for (const [directory, version] of Object.entries(versions)) {
      mkdirSync(join(cwd, directory), { recursive: true });
      writeFileSync(
        join(cwd, directory, "package.json"),
        `${JSON.stringify({ name: directory, version })}\n`,
        "utf8",
      );
    }
    writeStub(cwd, "npm", 'echo "$*" >> "$NPM_LOG"\n');

    return {
      cwd,
      env: {
        ACCESS: "public",
        DIST_TAG: "",
        GITHUB_OUTPUT: output,
        NPM_LOG: npmLog,
        PACKAGES: Object.keys(versions).join("\n"),
        PROVENANCE: "true",
      },
      npmLog,
      output,
    };
  }

  it("publishes sidecars before the main package, on latest", () => {
    const fixture = npmFixture({ "sidecar-a": "1.2.3", "sidecar-b": "1.2.3", main: "1.2.3" });

    expect(runShell(script, fixture.cwd, fixture.env).status).toBe(0);
    expect(logLines(fixture.npmLog)).toStrictEqual([
      "publish sidecar-a --access public --tag latest --provenance",
      "publish sidecar-b --access public --tag latest --provenance",
      "publish main --access public --tag latest --provenance",
    ]);
    expect(readFileSync(fixture.output, "utf8")).toBe("dist-tag=latest\n");
  });

  it.each([
    ["1.2.3-rc.1", "rc"],
    ["1.2.3-next.4", "next"],
    ["1.2.3-1", "next"],
    ["1.2.3-beta.0+build.7", "beta"],
  ])("derives the dist-tag %s → %s from the main package", (version, tag) => {
    // The sidecar deliberately carries a different version: the tag comes from
    // the last entry, the main package.
    const fixture = npmFixture({ "sidecar-a": "9.9.9", main: version });

    expect(runShell(script, fixture.cwd, fixture.env).status).toBe(0);
    expect(readFileSync(fixture.output, "utf8")).toBe(`dist-tag=${tag}\n`);
    expect(logLines(fixture.npmLog).at(-1)).toBe(
      `publish main --access public --tag ${tag} --provenance`,
    );
  });

  it("honors an explicit dist-tag and provenance: false", () => {
    const fixture = npmFixture({ main: "1.2.3-rc.1" });
    const result = runShell(script, fixture.cwd, {
      ...fixture.env,
      DIST_TAG: "canary",
      PROVENANCE: "false",
    });

    expect(result.status).toBe(0);
    expect(logLines(fixture.npmLog)).toStrictEqual(["publish main --access public --tag canary"]);
  });
});
