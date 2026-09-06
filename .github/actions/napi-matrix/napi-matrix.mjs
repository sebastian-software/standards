#!/usr/bin/env node
// Turns the org-wide napi platform list into a job matrix and the derived
// names, so a repository never writes a platform triple down twice. Reads
// `platforms.json` next to this file; writes `matrix`, `platform-ids` and
// `sidecars` to $GITHUB_OUTPUT when that variable is set, and prints them
// otherwise.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DATA = join(import.meta.dirname, "platforms.json");

function parseList(value) {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Decision D7: a platform sidecar is `<main package>-<platform id>`, which puts
// a scoped package's sidecars in the same scope as the package itself. The
// native binary follows the @napi-rs/cli default, `<binary>.<platform id>.node`.
export function buildMatrix(platforms, { packageName, include = [], exclude = [] }) {
  const selected = platforms
    .filter((platform) => include.length === 0 || include.includes(platform.id))
    .filter((platform) => !exclude.includes(platform.id));

  const unknown = [...include, ...exclude].filter(
    (id) => !platforms.some((platform) => platform.id === id),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown platform id(s): ${unknown.join(", ")}`);
  }
  if (selected.length === 0) {
    throw new Error("The platform selection is empty.");
  }

  const binary = packageName.includes("/") ? packageName.split("/")[1] : packageName;

  return selected.map((platform) => ({
    ...platform,
    sidecar: `${packageName}-${platform.id}`,
    artifact: `native-${platform.id}`,
    binary: `${binary}.${platform.id}.node`,
  }));
}

function emit(outputs) {
  const target = process.env.GITHUB_OUTPUT;
  for (const [key, value] of Object.entries(outputs)) {
    if (target === undefined || target.length === 0) {
      process.stdout.write(`${key}=${value}\n`);
    } else {
      appendFileSync(target, `${key}=${value}\n`, "utf8");
    }
  }
}

function main() {
  const packageName = process.env.INPUT_PACKAGE ?? "";
  if (packageName.length === 0) {
    process.stderr.write("napi-matrix: the `package` input is required.\n");
    return 2;
  }

  const data = JSON.parse(readFileSync(DATA, "utf8"));
  let entries;
  try {
    entries = buildMatrix(data.platforms, {
      packageName,
      include: parseList(process.env.INPUT_PLATFORMS),
      exclude: parseList(process.env.INPUT_EXCLUDE),
    });
  } catch (error) {
    process.stderr.write(`napi-matrix: ${error.message}\n`);
    return 1;
  }

  emit({
    matrix: JSON.stringify({ include: entries }),
    "platform-ids": entries.map((entry) => entry.id).join(" "),
    sidecars: JSON.stringify(entries.map((entry) => entry.sidecar)),
  });
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
