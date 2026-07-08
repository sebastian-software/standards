export function copyrightYears(since: number, current: number): string {
  return since >= current ? String(current) : `${String(since)}&ndash;${String(current)}`;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replaceAll(/\{\{(?<key>\w+)\}\}/gu, (match, key: string) => vars[key] ?? match);
}

export type SectionResult = {
  content: string;
  action: "appended" | "replaced" | "unchanged";
};

export function upsertSection(content: string, marker: string, body: string): SectionResult {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${start}\n\n${body.trim()}\n${end}`;

  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);

  if (startIndex !== -1 && endIndex > startIndex) {
    const existing = content.slice(startIndex, endIndex + end.length);
    if (existing === block) {
      return { content, action: "unchanged" };
    }
    return {
      content: content.slice(0, startIndex) + block + content.slice(endIndex + end.length),
      action: "replaced",
    };
  }

  const separator = content.endsWith("\n") ? "" : "\n";
  return { content: `${content}${separator}\n---\n\n${block}\n`, action: "appended" };
}
