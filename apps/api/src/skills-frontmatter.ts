import { parse as parseYaml } from "yaml";

/**
 * Skill markdown frontmatter. A skill's identity is its filename, so only the
 * optional description is read here; unparseable frontmatter is simply absent.
 */
export interface SkillMarkdown {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

const frontmatter = (raw: string): { data: Record<string, unknown>; body: string } => {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    return { data: {}, body: match[2] ?? "" };
  }
  const data =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  return { data, body: match[2] ?? "" };
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Returns null when the document carries no usable name and description pair. */
export const parseSkillMarkdown = (raw: string): SkillMarkdown | null => {
  const { data, body } = frontmatter(raw);
  const name = text(data.name);
  const description = text(data.description);
  return name === undefined || description === undefined ? null : { name, description, body };
};
