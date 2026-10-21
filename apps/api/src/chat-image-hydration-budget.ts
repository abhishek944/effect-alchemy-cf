import type { Context } from "@earendil-works/pi-ai";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { effectiveGenerationOutputTokens } from "./chat-generation-output-budget.ts";
import { MAX_FINAL_REQUEST_BYTES } from "./chat-skills-guard.ts";
import { hydrationFailure } from "./chat-image-hydration-types.ts";

/** JSON UTF-8 string size without allocating an escaped string or encoded copy. */
const stringBytes = (value: string): number => {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32)
      bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 6;
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
};

export type HydrationContextSize = {
  readonly transportBytes: number;
  readonly textBytes: number;
  readonly textCharacters: number;
};

/** Exclude ONLY actual direct image blocks' data from text/guidance budgeting. */
export const measureHydrationContext = (context: Context): HydrationContextSize => {
  const images = new WeakSet<object>();
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "toolResult") continue;
    if (Array.isArray(message.content))
      for (const block of message.content) if (block.type === "image") images.add(block);
  }
  let transportBytes = 0;
  let textBytes = 0;
  let textCharacters = 0;
  let nodes = 262_144;
  const ancestors = new WeakSet<object>();
  const add = (bytes: number): void => {
    transportBytes += bytes;
    textBytes += bytes;
  };
  const string = (value: string): void => {
    if (value.length > MAX_FINAL_REQUEST_BYTES - textCharacters) hydrationFailure("text_budget");
    add(stringBytes(value));
    textCharacters += value.length;
  };
  const visit = (value: unknown, depth: number): void => {
    if (--nodes < 0 || depth > 64) hydrationFailure("invalid_context");
    if (value === null || value === undefined) {
      add(4);
      return;
    }
    if (typeof value === "string") {
      string(value);
      return;
    }
    if (typeof value === "boolean") {
      add(value ? 4 : 5);
      return;
    }
    if (typeof value === "number") {
      add(Number.isFinite(value) ? String(value).length : 4);
      return;
    }
    if (typeof value !== "object" || ancestors.has(value))
      return hydrationFailure("invalid_context");
    ancestors.add(value);
    if (Array.isArray(value)) {
      add(2 + Math.max(0, value.length - 1));
      for (const item of value) visit(item, depth + 1);
    } else {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) hydrationFailure("invalid_context");
      add(2);
      let fields = 0;
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        if (fields++ > 0) add(1);
        string(key);
        add(1);
        if (images.has(value) && key === "data") {
          if (typeof child !== "string") return hydrationFailure("invalid_context");
          transportBytes += child.length + 2; // Validated canonical base64 is ASCII, unescaped.
          textBytes += 2;
        } else visit(child, depth + 1);
      }
    }
    ancestors.delete(value);
  };
  visit(context, 0);
  if (![transportBytes, textBytes, textCharacters].every(Number.isSafeInteger))
    hydrationFailure("invalid_context");
  return { transportBytes, textBytes, textCharacters };
};

export const assertHydrationTextBudget = (
  size: HydrationContextSize,
  model: ChatCatalogModel,
): void => {
  const output = effectiveGenerationOutputTokens(model.contextWindow, model.maxOutputTokens);
  const budget = Math.min(MAX_FINAL_REQUEST_BYTES, (model.contextWindow - output) * 4);
  if (size.textBytes > budget) hydrationFailure("text_budget");
};

/** Installed SDK uses 4,800 estimated image characters, NEVER base64 length as tokens. */
export const assertHydrationTokenBudget = (context: Context, model: ChatCatalogModel): void => {
  const transcript = normalizeContext(context);
  const summed = transcript.messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  const tokens = Math.max(summed, estimateContextTokens(transcript).tokens);
  const output = effectiveGenerationOutputTokens(model.contextWindow, model.maxOutputTokens);
  const available = model.contextWindow - output;
  if (!Number.isFinite(tokens) || tokens > available) hydrationFailure("context_budget");
};
