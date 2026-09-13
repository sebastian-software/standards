import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extraIgnorePatterns,
  findNestedConfigDirs,
  mergeIgnoreFile,
  partitionIgnorePatterns,
  planIgnoreMigration,
  scopeToDirectory,
} from "../src/oxfmt-ignores.js";

const REFERENCE = `${JSON.stringify({ ignorePatterns: ["dist", "coverage"] })}\n`;
const HEADER = "# Moved from .oxfmtrc.json by `standards apply`.";
const UNMOVED =
  "# Not moved from .oxfmtrc.json by `standards apply`: each would change which files are checked.";

describe("extraIgnorePatterns", () => {
  it("returns the repository's own entries in their original sequence, duplicates included", () => {
    const actual = JSON.stringify({
      ignorePatterns: ["dist", " .sops.yaml ", "coverage", ".sops.yaml", "", "**/_generated/"],
    });

    expect(extraIgnorePatterns(actual, REFERENCE)).toStrictEqual([
      ".sops.yaml",
      ".sops.yaml",
      "**/_generated/",
    ]);
  });

  it("keeps an entry repeated after a negation, because it decides what the negation leaves", () => {
    const actual = JSON.stringify({ ignorePatterns: ["gen/*", "!gen/keep.ts", "gen/*"] });

    expect(extraIgnorePatterns(actual, REFERENCE)).toStrictEqual([
      "gen/*",
      "!gen/keep.ts",
      "gen/*",
    ]);
  });

  it("yields nothing for a missing file, invalid JSON or a value that is not a pattern list", () => {
    for (const actual of [undefined, "not json", "null", "[]", "{}", '{"ignorePatterns":"dist"}']) {
      expect(extraIgnorePatterns(actual, REFERENCE)).toStrictEqual([]);
    }
  });
});

describe("findNestedConfigDirs", () => {
  it("finds every nested config under any name oxfmt loads, declared as a workspace or not", () => {
    const cwd = mkdtempSync(join(tmpdir(), "standards-oxfmt-"));
    const files = {
      ".oxfmtrc.json": "{}\n",
      "packages/app/.oxfmtrc.json": "{}\n",
      "vendor/lib/.oxfmtrc.jsonc": "{}\n",
      "tools/fmt/oxfmt.config.ts": "export default {};\n",
      "tools/esm/oxfmt.config.mts": "export default {};\n",
      "tools/other/oxfmt.config.json": "{}\n",
      "tools/rc/.oxfmtrc": "{}\n",
      "docs/prettier.config.js": "export default {};\n",
      "node_modules/pkg/.oxfmtrc.json": "{}\n",
      "src/index.ts": "export {};\n",
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }

    expect(new Set(findNestedConfigDirs(cwd))).toStrictEqual(
      new Set(["packages/app", "vendor/lib", "tools/fmt", "tools/esm", "tools/other"]),
    );
  });
});

describe("partitionIgnorePatterns", () => {
  it("moves every positive pattern when no deeper config exists", () => {
    expect(partitionIgnorePatterns([".limen.yaml", "**/_generated/"], [])).toStrictEqual({
      moved: [".limen.yaml", "**/_generated/"],
      unmoved: [],
    });
  });

  it("keeps back a positive pattern that could reach a deeper config", () => {
    const patterns = [
      ".limen.yaml",
      "**/_generated/",
      "/build",
      ".limen/**/*.sops",
      "packages",
      "packages/*/out",
      "packages/web/out",
    ];

    expect(partitionIgnorePatterns(patterns, ["packages/app"])).toStrictEqual({
      moved: ["/build", ".limen/**/*.sops", "packages/web/out"],
      unmoved: [".limen.yaml", "**/_generated/", "packages", "packages/*/out"],
    });
  });

  it("moves nothing from a config that contains a negation", () => {
    expect(partitionIgnorePatterns(["/build", "gen/*", "!gen/keep.ts"], [])).toStrictEqual({
      moved: [],
      unmoved: ["/build", "gen/*", "!gen/keep.ts"],
    });
  });
});

describe("planIgnoreMigration", () => {
  const managed = ["dist", "**/dist", "coverage"];
  const reference = `${JSON.stringify({ ignorePatterns: managed })}\n`;
  const actual = JSON.stringify({ ignorePatterns: [...managed, "out", "src/legacy.ts"] });

  it("checks a workspace's entries only against configs below that workspace", () => {
    expect(
      planIgnoreMigration({
        actual,
        reference,
        dir: "packages/app",
        configDirs: ["packages/app", "packages/web", "packages/app/sub"],
      }),
    ).toStrictEqual({
      moved: ["packages/app/src/legacy.ts"],
      unmoved: ["packages/app/**/out"],
      local: ["src/legacy.ts"],
    });
  });

  it("checks root entries against every workspace config", () => {
    expect(
      planIgnoreMigration({ actual, reference, dir: "", configDirs: ["packages/app"] }),
    ).toStrictEqual({ moved: ["src/legacy.ts"], unmoved: ["out"], local: [] });
  });

  it("keeps a workspace config with a negation whole, rewritten relative to the root", () => {
    const negated = JSON.stringify({ ignorePatterns: [...managed, "gen/*", "!gen/keep.ts"] });

    expect(
      planIgnoreMigration({ actual: negated, reference, dir: "packages/app", configDirs: [] }),
    ).toStrictEqual({
      moved: [],
      unmoved: ["packages/app/gen/*", "!packages/app/gen/keep.ts"],
      local: [],
    });
  });

  it("pairs every moved workspace entry with its workspace-relative form, in sequence", () => {
    const mixed = JSON.stringify({
      ignorePatterns: [...managed, "build/out", "out/cache", "src/legacy.ts", "build/out"],
    });

    expect(
      planIgnoreMigration({
        actual: mixed,
        reference,
        dir: "packages/app",
        configDirs: ["packages/app/out"],
      }),
    ).toStrictEqual({
      moved: ["packages/app/build/out", "packages/app/src/legacy.ts", "packages/app/build/out"],
      unmoved: ["packages/app/out/cache"],
      local: ["build/out", "src/legacy.ts", "build/out"],
    });
  });
});

describe("scopeToDirectory", () => {
  it("keeps a root pattern unchanged", () => {
    expect(scopeToDirectory("dist", "")).toBe("dist");
  });

  it("lets an unanchored pattern keep matching at every depth of the workspace", () => {
    expect(scopeToDirectory("dist", "packages/app")).toBe("packages/app/**/dist");
    expect(scopeToDirectory("build/", "packages/app")).toBe("packages/app/**/build/");
  });

  it("keeps an anchored pattern anchored to the workspace", () => {
    expect(scopeToDirectory("_generated/api.d.ts", "packages/app")).toBe(
      "packages/app/_generated/api.d.ts",
    );
    expect(scopeToDirectory("/coverage", "packages/app")).toBe("packages/app/coverage");
  });

  it("carries a negation through", () => {
    expect(scopeToDirectory("!keep.yaml", "packages/app")).toBe("!packages/app/**/keep.yaml");
  });
});

describe("mergeIgnoreFile", () => {
  it("creates the file with a header", () => {
    expect(mergeIgnoreFile(undefined, ["a"])).toBe(`${HEADER}\na\n`);
  });

  it("returns nothing when there is nothing to add", () => {
    expect(mergeIgnoreFile("a\n", [])).toBeUndefined();
    expect(mergeIgnoreFile(`${UNMOVED}\n# b\n`, [], ["b"])).toBeUndefined();
  });

  it("appends a moved pattern even when the file already carries it above a negation", () => {
    expect(mergeIgnoreFile("gen/*\n!gen/keep.ts\n", ["gen/*"])).toBe(
      `gen/*\n!gen/keep.ts\n\n${HEADER}\ngen/*\n`,
    );
  });

  it("lists unmoved patterns as comments under their own header, once", () => {
    const merged = `${HEADER}\n/build\n\n${UNMOVED}\n# .limen.yaml\n`;

    expect(mergeIgnoreFile(undefined, ["/build"], [".limen.yaml"])).toBe(merged);
    expect(mergeIgnoreFile(merged, [], [".limen.yaml"])).toBeUndefined();
  });

  it("does not repeat the header on a later migration", () => {
    expect(mergeIgnoreFile(`${HEADER}\na\n`, ["b"])).toBe(`${HEADER}\na\n\nb\n`);
  });
});
