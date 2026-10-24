import type { Ai } from "@cloudflare/workers-types";
import {
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAI } from "agents/models/pi-ai";
import { reportFailure, withDiagnostic } from "@starter/diagnostics";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { TitleResponse } from "./chat-accounting-model.ts";
import { guardTitlePayload, titleReasoning, TITLE_MAX_TOKENS } from "./chat-title-policy.ts";

export type TitleUsageObserver = (
  message: TitleResponse | null,
  selection: ChatSelection,
) => Promise<void>;
export type ChatTitleNamer = (
  text: string,
  selection: ChatSelection,
  recordUsage: TitleUsageObserver,
) => Promise<string | null>;

const TITLE_MAX_CHARS = 60;
const TITLE_MAX_INPUT = 2000;
const TITLE_DEADLINE_MS = 10_000;

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

const titleFromMessage = (message: AssistantMessage): string | null => {
  if (message.stopReason === "error" || message.errorMessage !== undefined)
    throw withDiagnostic(new Error("Title generation failed"), "title_provider_result_failed");
  if (message.stopReason !== "stop") return null;
  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ");
  return sanitizeTitle(text);
};

/** One bounded same-model call; null keeps the local excerpt. */
export const makeChatTitleNamer = (
  binding: Ai | undefined,
  gatewayId: string | undefined,
): ChatTitleNamer | null => {
  if (binding === undefined || gatewayId === undefined || gatewayId.length === 0) return null;
  const ai = createAI({ binding, id: gatewayId, skipCache: true, retries: { maxAttempts: 1 } });
  return async (text, selection, recordUsage) => {
    if (text.trim().length === 0) return null;
    const model: Model<string> = ai(selection.model);
    const reasoning = titleReasoning(model);
    const effective: ChatSelection = { ...selection, effort: reasoning ?? "off" };
    try {
      await recordUsage(null, effective);
    } catch (error) {
      reportTitleFailure(error, "title.usage", "title_usage_claim_failed", { phase: "claim" });
      return null;
    } // Do not initiate paid naming if its claim cannot be attributed.
    const options: SimpleStreamOptions = {
      maxTokens: TITLE_MAX_TOKENS,
      maxRetries: 0,
      signal: AbortSignal.timeout(TITLE_DEADLINE_MS),
      onPayload: (payload) => guardTitlePayload(payload, model, reasoning),
      thinkingBudgets: { minimal: 1024, low: 1024, medium: 1024, high: 1024 },
      ...(reasoning === undefined ? {} : { reasoning }),
    };
    const context: Context = {
      systemPrompt: TITLE_INSTRUCTIONS,
      messages: [
        { role: "user", content: sliceCodePoints(text, TITLE_MAX_INPUT), timestamp: Date.now() },
      ],
    };
    const message = await ai.completeSimple(model, context, options);
    try {
      await recordUsage(message, effective);
    } catch (error) {
      reportTitleFailure(error, "title.usage", "title_usage_record_failed", { phase: "record" });
    }
    return titleFromMessage(message);
  };
};
