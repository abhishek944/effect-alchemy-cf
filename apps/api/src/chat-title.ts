export { makeChatTitleNamer } from "./chat-title-generate.ts";
import { reportFailure } from "@highchat/diagnostics";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { TitleResponse } from "./chat-accounting-model.ts";

export type TitleUsageObserver = (
  message: TitleResponse | null,
  selection: ChatSelection,
) => Promise<void>;
export type ChatTitleNamer = (
  text: string,
  selection: ChatSelection,
  recordUsage: TitleUsageObserver,
  identity: { readonly userId: string; readonly sessionId: string },
) => Promise<string | null>;

const TITLE_MAX_CHARS = 60;

/** Title naming is best effort; this is its final owner for otherwise-lost evidence. */
export const reportTitleFailure = (
  error: unknown,
  operation: "title.setup" | "title.generate" | "title.usage" | "title.persist",
  reason: string,
  ids: { readonly chatId?: string; readonly operationId?: string; readonly phase?: string } = {},
): void =>
  reportFailure(error, {
    component: "chat-title",
    operation,
    reason,
    ...ids,
    event: "application.recovery",
  });

export const TITLE_INSTRUCTIONS = `Name this saved chat from the user's first message.
Reply with only the title: 3 to 6 words, at most 60 characters, in the message's main language.
Use one plain line with no quotes, Markdown, emoji, or "Title:" prefix.`;

const collapse = (value: string): string => value.replace(/\s+/gu, " ").trim();

const sliceCodePoints = (value: string, limit: number): string =>
  Array.from(value).slice(0, limit).join("");

/** Short local fallback shown until a bounded title call succeeds. */
export const excerptTitle = (text: string): string => {
  const excerpt = sliceCodePoints(collapse(text), TITLE_MAX_CHARS);
  return excerpt.length > 0 ? excerpt : "New chat";
};

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["`", "`"],
  ["**", "**"],
  ["__", "__"],
  ["~~", "~~"],
  ["*", "*"],
  ["_", "_"],
];

const stripWrapped = (value: string): string => {
  let next = collapse(value);
  for (let pass = 0; pass < 3; pass += 1) {
    const pair = QUOTE_PAIRS.find(
      ([open, close]) =>
        next.length > open.length + close.length && next.startsWith(open) && next.endsWith(close),
    );
    if (pair === undefined) break;
    next = collapse(next.slice(pair[0].length, next.length - pair[1].length));
  }
  return next;
};

const LINE_BREAKS = /[\r\n\u2028\u2029]/u;

/** Structured, fenced or embedded-Markdown output is not a title. */
const isMarkupTitle = (value: string): boolean =>
  /^\s*[[{]/u.test(value) ||
  /\{\s*"/u.test(value) ||
  /\[\s*"/u.test(value) ||
  /```|~~~/u.test(value) ||
  /\[[^\]]*\]\([^)]*\)/u.test(value) ||
  /`/u.test(value) ||
  /\*\*|__|~~/u.test(value) ||
  /(?<![\p{L}\p{N}*])\*(?!\s)[^*\n]*\*(?![\p{L}\p{N}*])/u.test(value) ||
  /(?<![\p{L}\p{N}_])_(?!\s)[^_\n]*_(?![\p{L}\p{N}_])/u.test(value);

/** One plain line only; surrounding quotes/prefix markers are stripped later. */
export const sanitizeTitle = (raw: string): string | null => {
  const lines = raw
    .trim()
    .split(LINE_BREAKS)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) return null;
  const line = lines[0];
  if (line === undefined || /```|~~~/u.test(line)) return null;
  const stripped = stripWrapped(
    stripWrapped(collapse(line)).replace(/^(?:title|name)\s*[:#-]\s*/iu, ""),
  ).replace(/^[#>*_~`-]+\s*/u, "");
  if (isMarkupTitle(stripped)) return null;
  const bounded = sliceCodePoints(stripped, TITLE_MAX_CHARS).trim();
  if (
    bounded.length === 0 ||
    !/[\p{L}\p{N}]/u.test(bounded) ||
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u.test(bounded)
  )
    return null;
  return bounded;
};
