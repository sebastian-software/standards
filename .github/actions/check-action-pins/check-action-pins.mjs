#!/usr/bin/env node
// Every `uses:` in a workflow or composite action must name a full 40-character
// commit SHA with the human-readable version in a trailing comment, so a moved
// tag cannot change what CI executes. A `docker://` reference must name an
// immutable `@sha256:` digest for the same reason — an image tag moves just
// like a git tag. Local (`./…`) references are exempt: they are part of the
// checkout, not a third-party dependency.
//
// The scan is line-based on purpose: this runs in a job that only checks the
// repository out, with no dependency install, so it cannot pull in a YAML
// parser. To keep that safe it recognizes every shape a `uses` key can take —
// block (`- uses: x`), flow (`- { uses: x }`) and quoted (`"uses": x`) — and
// fails loudly on any `uses` key it cannot classify rather than skipping it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const USES_KEY = /(?:^|[\s{,])(?:uses|"uses"|'uses')\s*:/;
const BLOCK_USES = /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*(?<ref>[^\s#]+)\s*(?<rest>.*)$/;
const FLOW_USES = /(?:^|[\s{,])(?:uses|"uses"|'uses')\s*:\s*(?<ref>[^\s,}]+)/g;
const PINNED = /^[^\s@]+@[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/;
const DOCKER = /^docker:\/\//;
const VERSION_COMMENT = /#\s*\S/;

function unquote(value) {
  return value.replaceAll(/^['"]|['"]$/g, "");
}

// Returns every `uses` value on the line, or null when the line has a `uses`
// key in a shape this scanner does not understand.
function usesReferences(line) {
  const block = BLOCK_USES.exec(line);
  if (block) {
    return [{ ref: unquote(block.groups.ref), rest: block.groups.rest }];
  }

  if (line.includes("{")) {
    // A YAML comment can only sit at the end of the line — inside a flow
    // mapping a `#` would end the mapping — so the rest of the line after the
    // reference is where the version comment has to be.
    const flow = [...line.matchAll(FLOW_USES)].map((match) => ({
      ref: unquote(match.groups.ref),
      rest: line.slice(match.index + match[0].length),
    }));
    if (flow.length > 0) {
      return flow;
    }
  }

  return null;
}

function yamlFiles(target) {
  const info = statSync(target);
  if (info.isFile()) {
    return /\.ya?ml$/.test(target) ? [target] : [];
  }
  const files = [];
  const pending = [target];
  while (pending.length > 0) {
    const current = pending.pop();
    const entry = statSync(current);
    if (entry.isDirectory()) {
      for (const name of readdirSync(current)) {
        pending.push(join(current, name));
      }
    } else if (entry.isFile() && /\.ya?ml$/.test(current)) {
      files.push(current);
    }
  }
  return files.sort();
}

// Returns the problem with one reference, or an empty string when it is fine.
function problemFor(ref, rest, allowed) {
  if (allowed.has(ref) || ref.startsWith("./")) {
    return "";
  }
  if (ref.includes("${{")) {
    return "an expression is not a pin; add the reference to `allow` when it genuinely cannot be a SHA";
  }
  if (DOCKER.test(ref)) {
    return DOCKER_DIGEST.test(ref) ? "" : `"${ref}" is not pinned to an immutable @sha256: digest`;
  }
  if (!PINNED.test(ref)) {
    return `"${ref}" is not pinned to a full 40-character commit SHA`;
  }
  if (!VERSION_COMMENT.test(rest)) {
    return `"${ref}" is missing the trailing "# <version>" comment`;
  }
  return "";
}

// Returns the problems on one line, and counts the references it classified.
function scanLine(line, location, allowed) {
  const references = usesReferences(line);
  if (references === null) {
    return {
      checked: 0,
      problems: [`${location}: a "uses" key is present but could not be read: ${line.trim()}`],
    };
  }

  const problems = references
    .map(({ ref, rest }) => problemFor(ref, rest, allowed))
    .filter((problem) => problem.length > 0)
    .map((problem) => `${location}: ${problem}`);

  return { checked: references.length, problems };
}

export function checkPins(targets, allow = []) {
  const allowed = new Set(allow);
  const files = targets.flatMap((target) => yamlFiles(target));
  const problems = [];
  let checked = 0;

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!USES_KEY.test(line)) {
        continue;
      }
      const location = `${relative(process.cwd(), file) || file}:${index + 1}`;
      const result = scanLine(line, location, allowed);
      checked += result.checked;
      problems.push(...result.problems);
    }
  }

  return { checked, files, problems };
}

function report(result, targets) {
  if (result.files.length === 0) {
    process.stderr.write(`No YAML files found in ${targets.join(", ")}\n`);
    return 2;
  }
  if (result.problems.length > 0) {
    process.stderr.write("Workflow action pins are not compliant:\n");
    for (const problem of result.problems) {
      process.stderr.write(`  ${problem}\n`);
    }
    return 1;
  }
  process.stdout.write(
    `Action pins verified (${result.checked} references in ${result.files.length} files)\n`,
  );
  return 0;
}

function main(argv) {
  const targets = argv.length > 0 ? argv : [".github/workflows"];
  const allow = (process.env.ALLOWED_USES ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  try {
    return report(checkPins(targets, allow), targets);
  } catch (error) {
    process.stderr.write(`Failed to scan ${targets.join(", ")}: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
