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
 * Moving must not change which files are checked, so entries move only when the
 * result is provably the same. oxfmt applies `ignorePatterns` and
 * `.prettierignore` as separate layers and excludes a file when either layer
 * does, so a set of positive entries means the same in either place. A negation
 * does not: gitignore matching is order-sensitive and a negation only overrides
 * lines of its own file, so splitting a config that contains one, or placing the
 * negation next to lines it never saw, changes the result. And `.prettierignore`
 * applies to the whole tree, while a config's `ignorePatterns` never reached a
 * deeper directory with its own config.
 *
 * So a config with any negation moves nothing, and a positive entry that could
 * reach a workspace whose config existed before this run stays as well. Every
 * entry that does not move is written below the moved ones as a comment, so the
 * drift pull request shows it and a person or the agent decides what to do.
 */

export const OXFMT_CONFIG = ".oxfmtrc.json";
export const IGNORE_FILE = ".prettierignore";

const MIGRATION_COMMENT = "# Moved from .oxfmtrc.json by `standards apply`.";
const UNMOVED_COMMENT =
  "# Not moved from .oxfmtrc.json by `standards apply`: each would change which files are checked.";

export type IgnoreMigration = { moved: string[]; unmoved: string[] };

export type IgnoreMigrationInput = {
  /** The repository's config before it is overwritten. */
  actual: string | undefined;
  /** The managed config that replaces it. */
  reference: string;
  /** The unit the config belongs to, `""` for the repository root. */
  dir: string;
  /** Every workspace directory whose oxfmt config existed before this run. */
  configDirs: string[];
};

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
 * carry, in their original sequence — duplicates included, because an entry
 * repeated after a negation decides what that negation leaves in place. Content
 * that is not a JSON object with a string array yields nothing: there is no
 * intent to keep.
 */
export function extraIgnorePatterns(actual: string | undefined, reference: string): string[] {
  const managed = new Set(ignorePatternsOf(reference));
  return (ignorePatternsOf(actual) ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "" && !managed.has(pattern));
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

function hasGlob(segment: string): boolean {
  return /[*?[]/u.test(segment);
}

/**
 * A pattern as root-relative path segments. An unanchored pattern matches at
 * every depth, which is exactly a leading `**`.
 */
function toSegments(pattern: string): string[] {
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  const segments = pattern.split("/").filter((segment) => segment !== "");
  return anchored ? segments : ["**", ...segments];
}

/**
 * Whether a pattern could exclude something inside `dir`: it could match `dir`
 * itself, one of its ancestors, or a path below it. A wildcard is assumed to
 * match, so the answer errs towards `true`.
 */
function mayReach(pattern: string[], dir: string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined || dir.length === 0) return true;
  if (hasGlob(head)) return true;
  return head === dir[0] && mayReach(rest, dir.slice(1));
}

/**
 * Splits one config's root-relative patterns into the ones whose effect
 * survives the move into the root `.prettierignore` and the ones it would
 * change. With a negation among them none moves; otherwise a pattern stays only
 * when it could reach a deeper config directory.
 */
export function partitionIgnorePatterns(
  patterns: string[],
  deeperConfigDirs: string[],
): IgnoreMigration {
  if (patterns.some((pattern) => pattern.startsWith("!"))) {
    return { moved: [], unmoved: [...patterns] };
  }
  const dirSegments = deeperConfigDirs.map((dir) => dir.split("/"));
  const moved: string[] = [];
  const unmoved: string[] = [];
  for (const pattern of patterns) {
    const target = toSegments(pattern);
    (dirSegments.some((dir) => mayReach(target, dir)) ? unmoved : moved).push(pattern);
  }
  return { moved, unmoved };
}

function normalizeDir(dir: string): string {
  return dir
    .split(/[\\/]+/u)
    .filter((segment) => segment !== "")
    .join("/");
}

/** What to do with the repository's own entries of one config being overwritten. */
export function planIgnoreMigration(input: IgnoreMigrationInput): IgnoreMigration {
  const dir = normalizeDir(input.dir);
  const deeper = input.configDirs
    .map((configDir) => normalizeDir(configDir))
    .filter((configDir) => configDir !== dir && (dir === "" || configDir.startsWith(`${dir}/`)));
  return partitionIgnorePatterns(
    extraIgnorePatterns(input.actual, input.reference).map((pattern) =>
      scopeToDirectory(pattern, dir),
    ),
    deeper,
  );
}

function withTrailingNewline(existing: string | undefined): string {
  if (existing === undefined || existing === "") return "";
  return existing.endsWith("\n") ? existing : `${existing}\n`;
}

/** The lines of one block, preceded by its header unless the file already carries it. */
function withHeader(present: Set<string>, header: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return present.has(header) ? lines : [header, ...lines];
}

function appendBlock(base: string, lines: string[]): string {
  if (lines.length === 0) return base;
  const separator = base === "" ? "" : "\n";
  return `${base}${separator}${lines.join("\n")}\n`;
}

/**
 * The ignore file with every moved pattern appended and every unmoved one listed
 * as a comment under its own header, or `undefined` when there is nothing to
 * add. Existing lines are never reordered or removed.
 *
 * A moved pattern is appended even when the file already carries it: a negation
 * the repository wrote below that line would otherwise override an exclusion the
 * config applied, and only the appended copy keeps it in force. A comment that is
 * already present is not repeated, because comments change nothing.
 */
export function mergeIgnoreFile(
  existing: string | undefined,
  patterns: string[],
  unmoved: string[] = [],
): string | undefined {
  const present = new Set((existing ?? "").split(/\r?\n/u).map((line) => line.trim()));
  const missingUnmoved = unmoved
    .map((pattern) => `# ${pattern}`)
    .filter((line) => !present.has(line));
  if (patterns.length === 0 && missingUnmoved.length === 0) return undefined;

  const withMoved = appendBlock(
    withTrailingNewline(existing),
    withHeader(present, MIGRATION_COMMENT, patterns),
  );
  return appendBlock(withMoved, withHeader(present, UNMOVED_COMMENT, missingUnmoved));
}
