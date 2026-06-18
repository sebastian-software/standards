import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import type { Platform, RepoMeta } from "./repo.js";

import { isPlatform, REPO_META_FILE, writeRepoMeta } from "./repo.js";

export type Visibility = RepoMeta["visibility"];

export type Streams = {
  input: Readable;
  output: Writable;
};

export type InitOptions = {
  visibility?: Visibility;
  since?: number;
  platform?: Platform;
  force?: boolean;
  interactive?: boolean;
  streams?: Streams;
};

const VISIBILITY_LONG: readonly Visibility[] = ["oss", "private"] as const;
const SINCE_MIN = 2000;
const GIT_TIMEOUT_MS = 2000;

export class InitError extends Error {}

export function isVisibility(value: string): value is Visibility {
  return (VISIBILITY_LONG as readonly string[]).includes(value);
}

function rangeMessage(currentYear: number): string {
  return `between ${String(SINCE_MIN)} and ${String(currentYear + 1)}`;
}

export function parseSinceValue(raw: string, currentYear: number): number {
  if (!/^[1-9]\d{3}$/u.test(raw)) {
    throw new InitError(
      `Year must be a 4-digit value ${rangeMessage(currentYear)} — got ${JSON.stringify(raw)}.`,
    );
  }
  const parsed = Number(raw);
  if (parsed < SINCE_MIN || parsed > currentYear + 1) {
    throw new InitError(`Year must be ${rangeMessage(currentYear)} — got ${String(parsed)}.`);
  }
  return parsed;
}

export function parseSinceFlag(raw: string, currentYear: number): number {
  try {
    return parseSinceValue(raw, currentYear);
  } catch (error) {
    if (error instanceof InitError) {
      throw new InitError(`--since: ${error.message}`);
    }
    throw error;
  }
}

export function parseVisibilityFlag(raw: string): Visibility {
  if (!isVisibility(raw)) {
    throw new InitError(`--visibility must be "oss" or "private" — got ${JSON.stringify(raw)}.`);
  }
  return raw;
}

export function parseVisibilityChoice(raw: string): undefined | Visibility {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "o" || normalized === "oss") return "oss";
  if (normalized === "p" || normalized === "private") return "private";
  return undefined;
}

export function parsePlatformFlag(raw: string): Platform {
  if (!isPlatform(raw)) {
    throw new InitError(`--platform must be "github" or "forgejo" — got ${JSON.stringify(raw)}.`);
  }
  return raw;
}

export function parsePlatformChoice(raw: string): Platform | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "g" || normalized === "github") return "github";
  if (normalized === "f" || normalized === "forgejo") return "forgejo";
  return undefined;
}

export function detectPlatform(cwd: string): Platform {
  const result = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (result.error !== undefined || result.status !== 0) return "forgejo";
  const url = result.stdout.trim();
  if (url === "") return "forgejo";
  return url.includes("github.com") ? "github" : "forgejo";
}

function parseGitYear(output: string, currentYear: number): number | undefined {
  const firstLine = output.split("\n", 1)[0]?.trim();
  if (firstLine === undefined || firstLine === "") return undefined;
  const yearStr = /^(?<year>\d{4})-/u.exec(firstLine)?.groups?.year;
  if (yearStr === undefined) return undefined;
  const year = Number(yearStr);
  return year >= SINCE_MIN && year <= currentYear + 1 ? year : undefined;
}

export function detectFirstCommitYear(cwd: string, currentYear: number): number | undefined {
  const result = spawnSync(
    "git",
    ["-C", cwd, "log", "--reverse", "--format=%cs", "--max-parents=0"],
    { encoding: "utf8", timeout: GIT_TIMEOUT_MS },
  );
  if (result.error !== undefined || result.status !== 0) return undefined;
  return parseGitYear(result.stdout, currentYear);
}

const DEFAULT_STREAMS: Streams = { input: process.stdin, output: process.stdout };

const VISIBILITY_MENU = `Repository visibility:
  (o) open source — public, marketing footer
  (p) private — internal, plain copyright
`;

const PLATFORM_MENU = `Repository platform:
  (g) GitHub
  (f) Forgejo
`;

type PromptContext = {
  rl: ReadlineInterface;
  output: Writable;
  currentYear: number;
  visibilityDefault: Visibility;
  sinceDefault: number;
  platformDefault: Platform;
};

async function promptVisibility(context: PromptContext): Promise<Visibility> {
  const { rl, output, visibilityDefault } = context;
  output.write(VISIBILITY_MENU);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await rl.question(`Choice [${visibilityDefault === "oss" ? "o" : "p"}]: `);
    if (answer.trim() === "") return visibilityDefault;
    const parsed = parseVisibilityChoice(answer);
    if (parsed !== undefined) return parsed;
    output.write("Please answer o, p, oss, or private.\n");
  }
  throw new InitError("Too many invalid attempts for visibility.");
}

function isTerminal(streams: Streams): boolean {
  if (streams.input !== process.stdin) return false;
  if (!process.stdin.isTTY) return false;
  return true;
}

function guardLibraryUsage(interactive: boolean, streams: Streams): void {
  if (!interactive) return;
  if (streams !== DEFAULT_STREAMS) return;
  if (process.stdin.isTTY) return;
  throw new InitError(
    "Interactive runInit requires a TTY on stdin or explicit streams in options.",
  );
}

async function promptSince(context: PromptContext): Promise<number> {
  const { rl, output, currentYear, sinceDefault } = context;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await rl.question(`Initial year [${String(sinceDefault)}]: `);
    const trimmed = answer.trim();
    if (trimmed === "") return sinceDefault;
    try {
      return parseSinceValue(trimmed, currentYear);
    } catch (error) {
      const message = error instanceof InitError ? error.message : "Invalid input.";
      output.write(`${message}\n`);
    }
  }
  throw new InitError("Too many invalid attempts for initial year.");
}

async function promptPlatform(context: PromptContext): Promise<Platform> {
  const { rl, output, platformDefault } = context;
  output.write(PLATFORM_MENU);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await rl.question(`Choice [${platformDefault === "github" ? "g" : "f"}]: `);
    if (answer.trim() === "") return platformDefault;
    const parsed = parsePlatformChoice(answer);
    if (parsed !== undefined) return parsed;
    output.write("Please answer g, f, github, or forgejo.\n");
  }
  throw new InitError("Too many invalid attempts for platform.");
}

type InteractiveDefaults = {
  currentYear: number;
  visibilityDefault: Visibility;
  sinceDefault: number;
  platformDefault: Platform;
};

async function resolveInteractive(
  streams: Streams,
  defaults: InteractiveDefaults,
  options: InitOptions,
): Promise<{ visibility: Visibility; since: number; platform: Platform }> {
  const rl = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: isTerminal(streams),
  });
  try {
    const context: PromptContext = { rl, output: streams.output, ...defaults };
    const visibility = options.visibility ?? (await promptVisibility(context));
    const since = options.since ?? (await promptSince(context));
    const platform = options.platform ?? (await promptPlatform(context));
    return { visibility, since, platform };
  } finally {
    rl.close();
  }
}

function ensureGuard(cwd: string, force: boolean): void {
  const path = join(cwd, REPO_META_FILE);
  if (!existsSync(path)) return;
  if (force) return;
  throw new InitError(
    `${REPO_META_FILE} already exists. Use \`standards apply\` to update, or \`standards init --force\` to reset.`,
  );
}

/**
 * Bootstraps a `.repometa.json` file in `cwd` interactively (with prompts on
 * the supplied streams) or non-interactively (via flag-style options).
 *
 * Side effect for library callers: interactive mode opens a `readline/promises`
 * interface on `options.streams` (defaulting to `process.stdin`/`process.stdout`)
 * and closes it in the `finally` block. With the default streams, that close
 * propagates to `process.stdin`, so the calling process cannot read from stdin
 * afterwards. Pass explicit `options.streams` to keep `process.stdin` open.
 */
export async function runInit(
  cwd: string,
  currentYear: number,
  options: InitOptions = {},
): Promise<RepoMeta> {
  ensureGuard(cwd, options.force ?? false);

  const streams = options.streams ?? DEFAULT_STREAMS;
  const interactive = options.interactive ?? false;
  guardLibraryUsage(interactive, streams);
  const visibilityDefault: Visibility = "oss";
  const sinceDefault = detectFirstCommitYear(cwd, currentYear) ?? currentYear;
  const platformDefault = detectPlatform(cwd);

  const defaults: InteractiveDefaults = {
    currentYear,
    visibilityDefault,
    sinceDefault,
    platformDefault,
  };
  const resolved = interactive
    ? await resolveInteractive(streams, defaults, options)
    : {
        visibility: options.visibility ?? visibilityDefault,
        since: options.since ?? sinceDefault,
        platform: options.platform ?? platformDefault,
      };

  const meta: RepoMeta = {
    standards: 0,
    visibility: resolved.visibility,
    since: resolved.since,
    platform: resolved.platform,
  };
  writeRepoMeta(cwd, meta);
  return meta;
}
