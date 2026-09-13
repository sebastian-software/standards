import { describe, expect, it } from "vitest";

import {
  extraIgnorePatterns,
  mergeIgnoreFile,
  partitionIgnorePatterns,
  planIgnoreMigration,
  scopeToDirectory,
} from "../src/oxfmt-ignores.js";

const REFERENCE = `${JSON.stringify({ ignorePatterns: ["dist", "coverage"] })}\n`;
const HEADER = "# Moved from .oxfmtrc.json by `standards apply`.";

describe("extraIgnorePatterns", () => {
  it("returns the repository's own entries in order, without managed ones or duplicates", () => {
    const actual = JSON.stringify({
      ignorePatterns: ["dist", " .sops.yaml ", "coverage", ".sops.yaml", "", "**/_generated/"],
    });

    expect(extraIgnorePatterns(actual, REFERENCE)).toStrictEqual([".sops.yaml", "**/_generated/"]);
  });

  it("yields nothing for a missing file, invalid JSON or a value that is not a pattern list", () => {
    for (const actual of [undefined, "not json", "null", "[]", "{}", '{"ignorePatterns":"dist"}']) {
      expect(extraIgnorePatterns(actual, REFERENCE)).toStrictEqual([]);
    }
  });
});

describe("negations", () => {
  it("keep their order behind the pattern they re-include from", () => {
    const actual = JSON.stringify({ ignorePatterns: ["dist", "gen/*", "!gen/keep.ts"] });
    const patterns = extraIgnorePatterns(actual, REFERENCE);

    expect(patterns).toStrictEqual(["gen/*", "!gen/keep.ts"]);
    expect(mergeIgnoreFile(undefined, patterns)).toBe(`${HEADER}\ngen/*\n!gen/keep.ts\n`);
  });
});

const UNMOVED =
  "# Not moved from .oxfmtrc.json by `standards apply`: each would change which files are checked.";
const MANAGED = ["dist", "**/dist", "coverage"];

describe("partitionIgnorePatterns", () => {
  it("moves every pattern when no deeper config exists", () => {
    expect(partitionIgnorePatterns([".limen.yaml", "**/_generated/"], MANAGED, [])).toStrictEqual({
      moved: [".limen.yaml", "**/_generated/"],
      unmoved: [],
    });
  });

  it("keeps back a pattern that could reach a deeper config", () => {
    const patterns = [
      ".limen.yaml",
      "**/_generated/",
      "/build",
      ".limen/**/*.sops",
      "packages",
      "packages/*/out",
      "packages/web/out",
    ];

    expect(partitionIgnorePatterns(patterns, MANAGED, ["packages/app"])).toStrictEqual({
      moved: ["/build", ".limen/**/*.sops", "packages/web/out"],
      unmoved: [".limen.yaml", "**/_generated/", "packages", "packages/*/out"],
    });
  });

  it("moves a negation only when no managed pattern could exclude its target", () => {
    const patterns = ["gen/*", "!gen/keep.ts", "!dist/keep.ts", "!keep.ts"];

    expect(partitionIgnorePatterns(patterns, MANAGED, [])).toStrictEqual({
      moved: ["gen/*", "!gen/keep.ts"],
      unmoved: ["!dist/keep.ts", "!keep.ts"],
    });
  });
});

describe("planIgnoreMigration", () => {
  const reference = `${JSON.stringify({ ignorePatterns: MANAGED })}\n`;
  const actual = JSON.stringify({ ignorePatterns: [...MANAGED, "out", "src/legacy.ts"] });

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
    });
  });

  it("checks root entries against every workspace config", () => {
    expect(
      planIgnoreMigration({ actual, reference, dir: "", configDirs: ["packages/app"] }),
    ).toStrictEqual({ moved: ["src/legacy.ts"], unmoved: ["out"] });
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

  it("changes nothing when every pattern is already present", () => {
    expect(mergeIgnoreFile("a\n  b\n", ["a", "b"])).toBeUndefined();
  });

  it("lists unmoved patterns as comments under their own header", () => {
    const merged = `${HEADER}\n/build\n\n${UNMOVED}\n# .limen.yaml\n`;

    expect(mergeIgnoreFile(undefined, ["/build"], [".limen.yaml"])).toBe(merged);
    expect(mergeIgnoreFile(merged, ["/build"], [".limen.yaml"])).toBeUndefined();
  });

  it("appends present lines after a missing one, so a negation still follows its exclusion", () => {
    expect(mergeIgnoreFile("!gen/keep.ts\n", ["gen/*", "!gen/keep.ts"])).toBe(
      `!gen/keep.ts\n\n${HEADER}\ngen/*\n!gen/keep.ts\n`,
    );
    expect(mergeIgnoreFile("gen/*\n", ["gen/*", "!gen/keep.ts"])).toBe(
      `gen/*\n\n${HEADER}\n!gen/keep.ts\n`,
    );
  });

  it("does not repeat the header on a later migration", () => {
    expect(mergeIgnoreFile(`${HEADER}\na\n`, ["b"])).toBe(`${HEADER}\na\n\nb\n`);
  });
});
