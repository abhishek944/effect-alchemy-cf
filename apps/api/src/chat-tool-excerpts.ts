import { Predicate } from "effect";

export type ToolExcerpt = { text: string; truncated: boolean };
/** Inspect only a bounded prefix; never serialize native values, details or diagnostics. */
export const safeToolText = (value: string, limit: number): ToolExcerpt => {
  const units = Math.max(0, Math.min(4096, limit));
  const prefix = value.slice(0, units);
  const text = prefix
    .replace(/<harness>[\s\S]*/gi, "[internal details withheld]")
    .replace(/-----BEGIN[^\r\n]*PRIVATE KEY-----[\s\S]*/g, "[credential withheld]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[credential withheld]")
    .replace(/data:[^\s]+|[A-Za-z0-9+/_=-]{48,}/g, "[encoded data withheld]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s"']+/gi, "[credential withheld]")
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][\w-]+/gi, "[credential withheld]")
    .replace(
      /\b[\w-]*(?:secret|token|password|credential|api[_-]?key|authorization|cookie)[\w-]*["']?\s*[:=]\s*[^\r\n,}]*/gi,
      "[credential withheld]",
    )
    .replace(
      /--[\w-]*(?:secret|token|password|credential|api[_-]?key)[\w-]*\s+[^\s]+/gi,
      "[credential withheld]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[credential withheld]@")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1[query withheld]")
    // oxlint-disable-next-line no-control-regex -- Strip non-printing control bytes from public text.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  let end = Math.min(units, text.length);
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
  return {
    text: text.slice(0, end),
    truncated: prefix !== value || text !== prefix || end < text.length,
  };
};
const INPUT_KEYS = [
  "argv",
  "command",
  "action",
  "name",
  "path",
  "query",
  "prompt",
  "code",
  "target",
];
export const toolInputExcerpt = (args: unknown, limit: number): ToolExcerpt => {
  if (!Predicate.isObject(args))
    return { text: safeToolText("Input unavailable", limit).text, truncated: true };
  let text = "";
  let truncated = false;
  let selected = 0;
  for (const key of INPUT_KEYS) {
    if (!Object.hasOwn(args, key)) continue;
    selected += 1;
    const value = args[key];
    let excerpt: ToolExcerpt;
    const remaining = Math.max(0, limit - text.length - key.length - 2);
    if (typeof value === "string") excerpt = safeToolText(value, remaining);
    else if (typeof value === "number" || typeof value === "boolean")
      excerpt = safeToolText(String(value), remaining);
    else if (Array.isArray(value) && (key === "argv" || key === "command")) {
      let argv = "";
      let count = 0;
      for (const arg of value) {
        if (count >= 32 || argv.length >= remaining || typeof arg !== "string") break;
        const part = safeToolText(arg, Math.max(0, remaining - argv.length));
        argv += `${count === 0 ? "" : " "}${part.text}`;
        truncated ||= part.truncated;
        count += 1;
      }
      excerpt = safeToolText(argv, remaining);
      truncated ||= count < value.length;
    } else excerpt = { text: "[structured value withheld]", truncated: true };
    if (text.length + key.length + 2 + excerpt.text.length + 1 > limit) {
      truncated = true;
      break;
    }
    text += `${text.length === 0 ? "" : "\n"}${key}: ${excerpt.text}`;
    truncated ||= excerpt.truncated;
  }
  // Stop after a bounded number of keys, including unknown fields.
  let keys = 0;
  for (const key in args) {
    if (!Object.hasOwn(args, key)) continue;
    keys += 1;
    if (!INPUT_KEYS.includes(key) || keys > selected) {
      truncated = true;
      break;
    }
  }
  return { text, truncated };
};
