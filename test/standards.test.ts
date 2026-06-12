import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runApply } from "../src/apply.js";
import { copyrightYears, renderTemplate, upsertSection } from "../src/branding.js";
import { runCheck } from "../src/check.js";

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

    expect(selectChanges(root, 0, ["common"])).toHaveLength(1);
    expect(selectChanges(root, 1, ["common", "node"])).toHaveLength(0);
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
      toVersion: 1,
      changes: selectChanges(root, 0, ["common", "node"]),
    });

    expect(prompt).toContain("repository standards — agent instructions");
    expect(prompt).toContain("0001-baseline.md");
    expect(prompt).toContain("visibility: oss");
  });
});
