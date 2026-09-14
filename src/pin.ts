import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding } from "./check.js";
import type { RepoMeta } from "./repo.js";

import { workspaceDirs } from "./sync.js";

// The shape of the `@sebastian-software/standards` pin — the second member of
// the alignment class next to the stamp mismatch.
//
// The stamp check proves that `.repometa.json#standards` equals the installed
// manifest version; nothing proved that a repository is *able* to make them
// equal. A range, a tag, a `catalog:` or `workspace:` reference and an `npm:`
// alias all leave the installed version to something other than a reviewed,
// exact pin, so the advice of a blocking stamp finding cannot be followed by
// raising a number. `package.json` is neither managed nor seeded, so
// `standards apply` cannot repair it — which is why the finding is blocking.

/**
 * A bare exact version literal in the SemVer 2.0.0 grammar. Deliberately one
 * regex and no semver library: the pin is written by `--save-exact` or by
 * Renovate, and neither produces `=0.11.1`, whitespace padding or an alias. The
 * package stays at zero runtime dependencies.
 *
 * - The core is three numeric identifiers without a leading zero.
 * - A prerelease after `-` is one or more dot-separated, non-empty identifiers;
 *   a purely numeric one has no leading zero.
 * - A build part after `+` is one or more dot-separated, non-empty identifiers,
 *   where leading zeros are allowed.
 *
 * The grammar alone is not enough: `isExactVersionLiteral` also holds a pin to
 * npm's own limits. `standards ci` uses this same check.
 */
export const EXACT_VERSION_LITERAL =
  // eslint-disable-next-line security/detect-unsafe-regex, regexp/prefer-d, regexp/no-useless-character-class -- anchored; the nested `(?:[.]identifier)*` repetition is unambiguous because only `.` separates repeated identifiers and `.` belongs to no identifier class, and the three prerelease branches are disjoint (letter or hyphen, `0`, nonzero-led digits), so matching stays linear on any input.
  /^(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)(?:-(?:[0-9]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9][0-9]*)(?:[.](?:[0-9]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9][0-9]*))*)?(?:[+][0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*)?$/u;

/**
 * The longest version string npm's `semver` parses. A longer literal is no
 * version to `npm-package-arg`, which resolves it as a mutable dist-tag.
 */
export const EXACT_VERSION_MAX_LENGTH = 256;

/**
 * Whether a declared specifier is a bare exact version literal npm resolves as
 * a version: the SemVer 2.0.0 grammar, at most `EXACT_VERSION_MAX_LENGTH`
 * characters, and a major, minor and patch no greater than
 * `Number.MAX_SAFE_INTEGER`. npm caps only those three; numeric prerelease and
 * build identifiers stay uncapped, as they are in `semver`.
 */
export function isExactVersionLiteral(specifier: string): boolean {
  return (
    specifier.length <= EXACT_VERSION_MAX_LENGTH &&
    EXACT_VERSION_LITERAL.test(specifier) &&
    (specifier.split(/[+-]/u, 1)[0] ?? "")
      .split(".")
      .every((part) => Number(part) <= Number.MAX_SAFE_INTEGER)
  );
}

/** Whether a code point is a C0 control, DEL, or a C1 control. */
function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * The form of a specifier that may be printed. A specifier containing `://`
 * (`git+ssh://user:token@host/…`, `https://user:pat@…`) is legal and would
 * otherwise reach CI logs, `check --json` and the stale-CLI output of `apply`
 * and `sync`, so it is reduced to its scheme (`git+ssh:`).
 *
 * Every control character (U+0000–U+001F, U+007F–U+009F) of the result is then
 * replaced by `?`, so a declared value cannot break a log line — a newline
 * followed by `::error::` would otherwise become a workflow command. This also
 * covers the JSON form of a non-string declaration.
 *
 * Deliberately not covered, so a later reader does not "fix" it: scp-style
 * `git@host:org/repo.git` carries no password and is echoed verbatim, and
 * `file:`/`link:` echo a local path verbatim.
 */
export function redactSpecifier(specifier: string): string {
  const index = specifier.indexOf("://");
  const reduced = index === -1 ? specifier : specifier.slice(0, index + 1);
  return Array.from(reduced, (char) => (isControlCode(char.codePointAt(0) ?? 0) ? "?" : char)).join(
    "",
  );
}

const WORKFLOW_DIRS = [".github/workflows", ".forgejo/workflows"];
const LANE_TOKENS = ["standards ci", "standards check", "@sebastian-software/standards"];

function isWorkflowFile(name: string): boolean {
  return name.endsWith(".yml") || name.endsWith(".yaml");
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function workflowFiles(cwd: string, dir: string): string[] {
  try {
    return readdirSync(join(cwd, dir))
      .filter((name) => isWorkflowFile(name))
      .map((name) => join(cwd, dir, name));
  } catch {
    return [];
  }
}

/**
 * Whether the repository demonstrably runs the standards CLI in CI: a
 * `*.yml`/`*.yaml` file directly in `.github/workflows/` or
 * `.forgejo/workflows/` that mentions `standards check`, `standards ci` or
 * `@sebastian-software/standards`. It is the precondition of the *absent*
 * member only — a node scope detected on a mere `package.json` is not a
 * standards consumer (a Rust project with a Node build harness is not).
 *
 * The detection is deliberately generous: a file wrongly read as a lane only
 * restores the unconditional behavior. It reads workflow YAML for presence
 * and never parses a version out of it; the shape of a Rust `dlx` pin stays
 * unverified. An unreadable file or directory counts as no lane.
 */
export function hasStandardsLane(cwd: string): boolean {
  return WORKFLOW_DIRS.flatMap((dir) => workflowFiles(cwd, dir)).some((file) => {
    const content = readOrUndefined(file);
    return content !== undefined && LANE_TOKENS.some((token) => content.includes(token));
  });
}

type ExaminedUnit = {
  /** `package.json` relative to the repository root. */
  path: string;
  name: unknown;
  /** Every declaration of the CLI in `devDependencies` and `dependencies`. */
  specifiers: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declarationsOf(manifest: Record<string, unknown>, cliName: string): string[] {
  return [manifest.devDependencies, manifest.dependencies].flatMap((field) => {
    if (!isRecord(field) || !Object.hasOwn(field, cliName)) {
      return [];
    }
    const value = field[cliName];
    return [typeof value === "string" ? value : JSON.stringify(value)];
  });
}

function readUnit(cwd: string, dir: string, cliName: string): ExaminedUnit | undefined {
  const path = join(dir, "package.json");
  const raw = readOrUndefined(join(cwd, path));
  if (raw === undefined) {
    return undefined;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(manifest)) {
    return undefined;
  }
  return { path, name: manifest.name, specifiers: declarationsOf(manifest, cliName) };
}

/**
 * Every directory in `[""] ∪ workspaceDirs(cwd, meta)` whose `package.json`
 * this run could parse. Being parseable is membership, not a tolerance: a unit
 * that cannot be read leaves the set entirely. `undefined` when
 * `workspaceDirs` throws — that validation must never turn a blocking exit `3`
 * into a thrown exit `1`, so the pin is simply not evaluated.
 *
 * Not `SyncContext.units`: `detectUnits` always includes the root, even for a
 * rust-only repository, and skips workspaces through `appliesInWorkspace`. The
 * independent walk is intentional.
 */
function examinedUnits(cwd: string, meta: RepoMeta, cliName: string): ExaminedUnit[] | undefined {
  let dirs: string[];
  try {
    dirs = workspaceDirs(cwd, meta);
  } catch {
    return undefined;
  }
  return ["", ...dirs]
    .map((dir) => readUnit(cwd, dir, cliName))
    .filter((unit): unit is ExaminedUnit => unit !== undefined);
}

export type PinInspection = {
  /** `pin` findings, blocking, in examined-unit order. */
  findings: Finding[];
  /**
   * The redacted specifier of the first examined unit that declares the CLI,
   * for `stampFinding`; `undefined` when no unit declares it, when the
   * repository is the CLI itself, or when the units could not be determined.
   */
  displaySpecifier: string | undefined;
};

function shapeFinding(path: string, cliName: string, display: string): Finding {
  return {
    kind: "pin",
    path,
    detail: `declares ${cliName} as \`${display}\`, which is not a bare exact version literal — set the specifier in this package.json to an exact version (for example \`0.11.1\`), in the dependency field it is declared in, and refresh the lockfile. \`standards apply\` does not repair this.`,
    blocking: true,
  };
}

function absentFinding(path: string, cliName: string): Finding {
  return {
    kind: "pin",
    path,
    detail: `a CI workflow runs the standards CLI, but no package.json declares ${cliName} — add it as a devDependency pinned to a bare exact version literal (for example \`0.11.1\`) with \`pnpm add --save-dev --save-exact ${cliName}@<version>\` and refresh the lockfile. \`standards apply\` does not repair this.`,
    blocking: true,
  };
}

/**
 * The `pin` findings and the specifier the stamp finding names, from one walk.
 *
 * - *Shape*: every examined unit that declares the CLI with anything but a bare
 *   exact version literal yields one finding at its `package.json`, whether or
 *   not a standards CI lane exists.
 * - *Absent*: when no examined unit declares the CLI and `hasStandardsLane`
 *   holds, one finding at the first examined unit.
 *
 * Two units declaring different exact versions is out of scope. When any
 * examined unit *is* the CLI (`name === cliName`), the whole repository is
 * exempt: a monorepo vendoring the CLI has its siblings consume it as
 * `workspace:*`, and a per-unit exemption would turn every sibling red.
 */
export function inspectPin(cwd: string, meta: RepoMeta, cliName: string): PinInspection {
  const units = examinedUnits(cwd, meta, cliName);
  if (units === undefined || units.some((unit) => unit.name === cliName)) {
    return { findings: [], displaySpecifier: undefined };
  }

  const declaring = units.filter((unit) => unit.specifiers.length > 0);
  // Within the first declaring unit, a non-exact declaration is the one worth
  // naming: an exact `devDependencies` entry must not hide a range beside it.
  const firstSpecifiers = declaring[0]?.specifiers ?? [];
  const shown = firstSpecifiers.find((specifier) => !isExactVersionLiteral(specifier));
  const first = shown ?? firstSpecifiers[0];
  const displaySpecifier = first === undefined ? undefined : redactSpecifier(first);

  const findings = declaring.flatMap((unit) => {
    const loose = unit.specifiers.find((specifier) => !isExactVersionLiteral(specifier));
    return loose === undefined ? [] : [shapeFinding(unit.path, cliName, redactSpecifier(loose))];
  });

  const [firstUnit] = units;
  if (declaring.length === 0 && firstUnit !== undefined && hasStandardsLane(cwd)) {
    findings.push(absentFinding(firstUnit.path, cliName));
  }

  return { findings, displaySpecifier };
}
