import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "../src/manifest.js";

type ExtraFile = {
  type: string;
  path: string;
  jsonpath: string;
};

type ProductConfig = {
  $schema: string;
  "release-type": string;
  "include-component-in-tag": boolean;
  packages: {
    ".": {
      component: string;
      "changelog-path": string;
      "extra-files"?: ExtraFile[];
    };
  };
  "bootstrap-sha"?: string;
  "last-release-sha"?: string;
};

const TEMPLATE_DIR = join(getPackageRoot(), "reference", "release-please");
const TEMPLATE_NAMES = [
  "node-product-release-config.json",
  "rust-node-product-release-config.json",
  "rust-product-release-config.json",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExtraFile(value: unknown): value is ExtraFile {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.path === "string" &&
    typeof value.jsonpath === "string"
  );
}

function assertExtraFiles(product: Record<string, unknown>): void {
  const extraFiles = product["extra-files"];
  if (
    extraFiles !== undefined &&
    (!Array.isArray(extraFiles) || !extraFiles.every((entry) => isExtraFile(entry)))
  ) {
    throw new TypeError("Invalid Release Please extra-files template");
  }
}

function assertProductConfig(value: unknown): asserts value is ProductConfig {
  if (!isRecord(value) || !isRecord(value.packages)) {
    throw new TypeError("Invalid Release Please product template");
  }

  const product = value.packages["."];
  if (
    typeof value.$schema !== "string" ||
    typeof value["release-type"] !== "string" ||
    typeof value["include-component-in-tag"] !== "boolean" ||
    !isRecord(product) ||
    typeof product.component !== "string" ||
    typeof product["changelog-path"] !== "string"
  ) {
    throw new TypeError("Invalid Release Please product template");
  }
  assertExtraFiles(product);
}

function readConfig(name: (typeof TEMPLATE_NAMES)[number]): ProductConfig {
  const config: unknown = JSON.parse(readFileSync(join(TEMPLATE_DIR, name), "utf8"));
  assertProductConfig(config);
  return config;
}

describe("Release Please product templates", () => {
  it("ships exactly the documented JSON variants", () => {
    const actual = readdirSync(TEMPLATE_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));

    expect(actual).toStrictEqual([...TEMPLATE_NAMES]);
  });

  it.each([
    ["node-product-release-config.json", "node"],
    ["rust-node-product-release-config.json", "rust"],
    ["rust-product-release-config.json", "rust"],
  ] as const)("%s defines one root product component", (name, releaseType) => {
    const config = readConfig(name);

    expect(config.$schema).toBe(
      "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
    );
    expect(config["release-type"]).toBe(releaseType);
    expect(config["include-component-in-tag"]).toBe(true);
    expect(Object.keys(config.packages)).toStrictEqual(["."]);
    expect(config.packages["."]).toMatchObject({
      component: "my-product",
      "changelog-path": "CHANGELOG.md",
    });
    expect(config["bootstrap-sha"]).toBeUndefined();
    expect(config["last-release-sha"]).toBeUndefined();
  });

  it("uses typed JSON version updates only for Node followers", () => {
    expect(
      readConfig("rust-product-release-config.json").packages["."]["extra-files"],
    ).toBeUndefined();
    expect(
      readConfig("node-product-release-config.json").packages["."]["extra-files"],
    ).toStrictEqual([
      {
        type: "json",
        path: "packages/my-product-cli/package.json",
        jsonpath: "$.version",
      },
    ]);
    expect(
      readConfig("rust-node-product-release-config.json").packages["."]["extra-files"],
    ).toStrictEqual([
      {
        type: "json",
        path: "package.json",
        jsonpath: "$.version",
      },
      {
        type: "json",
        path: "packages/my-product/package.json",
        jsonpath: "$.version",
      },
    ]);
  });

  it("documents every template and the two distinct SHA controls", () => {
    const guide = readFileSync(join(TEMPLATE_DIR, "README.md"), "utf8");

    for (const name of TEMPLATE_NAMES) {
      expect(guide).toContain(`](${name})`);
    }
    expect(guide).toContain("`bootstrap-sha`");
    expect(guide).toContain("`last-release-sha`");
  });
});
