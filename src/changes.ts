import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChangeEntry = {
  version: number;
  file: string;
  content: string;
  scopes: string[];
};

const CHANGE_FILE = /^(?<version>\d{4})-.*\.md$/u;
const SCOPES_LINE = /^- \*\*Scopes:\*\* (?<scopes>.+)$/mu;

function parseScopes(content: string): string[] {
  const scopes = SCOPES_LINE.exec(content)?.groups?.scopes;
  return scopes === undefined ? [] : scopes.split(",").map((scope) => scope.trim());
}

export function readChanges(packageRoot: string): ChangeEntry[] {
  const directory = join(packageRoot, "changes");
  return readdirSync(directory)
    .map((file) => ({ file, version: CHANGE_FILE.exec(file)?.groups?.version }))
    .filter((entry): entry is { file: string; version: string } => entry.version !== undefined)
    .map(({ file, version }) => {
      const content = readFileSync(join(directory, file), "utf8");
      return { version: Number(version), file, content, scopes: parseScopes(content) };
    })
    .sort((left, right) => left.version - right.version);
}

export function selectChanges(
  packageRoot: string,
  afterVersion: number,
  scopeNames: string[],
): ChangeEntry[] {
  return readChanges(packageRoot).filter(
    (entry) =>
      entry.version > afterVersion &&
      (entry.scopes.length === 0 || entry.scopes.some((scope) => scopeNames.includes(scope))),
  );
}
