import { describe, expect, it } from "vitest";

import { extraIgnorePatterns, mergeIgnoreFile, scopeToDirectory } from "../src/oxfmt-ignores.js";

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

  it("does not repeat the header on a later migration", () => {
    expect(mergeIgnoreFile(`${HEADER}\na\n`, ["b"])).toBe(`${HEADER}\na\n\nb\n`);
  });
});
