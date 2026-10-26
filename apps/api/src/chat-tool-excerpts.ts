import { Predicate } from "effect";
import { TOOL_OUTPUT_BYTES, TOOL_OUTPUT_LINES } from "./chat-tool-schema.ts";

export type ToolExcerpt = { text: string; truncated: boolean };
/** Inspect only a bounded prefix; never serialize native values, details or diagnostics. */
export const safeToolText = (value: string, limit: number): ToolExcerpt => {
  const units = Math.max(0, Math.min(TOOL_OUTPUT_BYTES, limit));
  let prefix = value.slice(0, units);
  if (prefix.length < value.length && /[\uD800-\uDBFF]/.test(prefix.at(-1) ?? ""))
    prefix = prefix.slice(0, -1);
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
  const lines = text.split("\n").slice(0, TOOL_OUTPUT_LINES).join("\n");
  const bytes = new TextEncoder().encode(lines);
  let end = Math.min(units, bytes.length);
  // Drop a split UTF-8 code point rather than add a replacement character beyond the byte cap.
  while (end > 0 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  const bounded = new TextDecoder().decode(bytes.subarray(0, end));
  return {
    text: bounded,
    truncated: prefix !== value || text !== prefix || bounded !== text,
  };
};
const INPUT_KEYS = [
  "attachmentId",
  "cursor",
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
  const bounded = safeToolText(text, limit);
  return { text: bounded.text, truncated: truncated || bounded.truncated };
};
