/**
 * The oxfmt config is managed byte-exact, so `standards apply` overwrites any
 * `ignorePatterns` entry a repository added to it. Dropping those entries turns
 * the repository's formatter check red on files it had deliberately excluded,
 * and nothing in the pull request says why.
 *
 * The supported place for repository-specific ignores is `.prettierignore`,
 * which oxfmt reads next to the directory it runs from. The seeded CI formats
 * from the repository root, and a `.prettierignore` inside a workspace is not
 * read from there, so every entry — including one from a workspace's own oxfmt
 * config — moves into the root file, rewritten relative to the root.
 *
 * A negation moves too. It keeps working when it re-includes a path that one of
 * the moved patterns excludes, because both then sit in the same file. A
 * negation that re-includes a path a managed pattern excludes cannot be kept
 * anywhere: oxfmt applies `ignorePatterns` and `.prettierignore` as separate
 * layers, and the managed config carries no repository lines. That path stays
 * excluded after `apply`; formatting the file is the way out.
 */

export const OXFMT_CONFIG = ".oxfmtrc.json";
export const IGNORE_FILE = ".prettierignore";

const MIGRATION_COMMENT = "# Moved from .oxfmtrc.json by `standards apply`.";

function ignorePatternsOf(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("ignorePatterns" in parsed)) {
    return undefined;
  }
  const patterns: unknown = parsed.ignorePatterns;
  if (!Array.isArray(patterns)) return undefined;
  return patterns.filter((pattern): pattern is string => typeof pattern === "string");
}

/**
 * The `ignorePatterns` entries of `actual` that the managed `reference` does not
 * carry, in their original order and without duplicates. Content that is not a
 * JSON object with a string array yields nothing: there is no intent to keep.
 */
export function extraIgnorePatterns(actual: string | undefined, reference: string): string[] {
  const managed = new Set(ignorePatternsOf(reference));
  const extras = (ignorePatternsOf(actual) ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "" && !managed.has(pattern));
  return [...new Set(extras)];
}

/**
 * Rewrites a pattern that applied inside `dir` so it means the same from the
 * repository root, following gitignore rules: a pattern with a slash before its
 * last character is anchored to its directory, any other pattern matches at
 * every depth below it.
 */
export function scopeToDirectory(pattern: string, dir: string): string {
  if (dir === "") return pattern;
  if (pattern.startsWith("!")) return `!${scopeToDirectory(pattern.slice(1), dir)}`;
  const prefix = dir.split(/[\\/]+/u).join("/");
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  const relative = pattern.replace(/^\/+/u, "");
  return anchored ? `${prefix}/${relative}` : `${prefix}/**/${relative}`;
}

/**
 * The ignore file with every missing pattern appended, or `undefined` when all
 * of them are already present. Existing lines are never reordered or removed.
 */
export function mergeIgnoreFile(
  existing: string | undefined,
  patterns: string[],
): string | undefined {
  const present = new Set((existing ?? "").split(/\r?\n/u).map((line) => line.trim()));
  const missing = patterns.filter((pattern) => !present.has(pattern));
  if (missing.length === 0) return undefined;

  const base =
    existing === undefined || existing === "" || existing.endsWith("\n")
      ? (existing ?? "")
      : `${existing}\n`;
  const header = present.has(MIGRATION_COMMENT) ? [] : [MIGRATION_COMMENT];
  const separator = base === "" ? "" : "\n";
  return `${base}${separator}${[...header, ...missing].join("\n")}\n`;
}
