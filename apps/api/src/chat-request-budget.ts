import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { effectiveGenerationOutputTokens } from "./chat-generation-output-budget.ts";

/** Text/guidance request ceiling; direct image payloads are excluded. */
export const MAX_FINAL_REQUEST_BYTES = 1_572_864;
export const requestBudgetBytes = (model: Model<Api>): number => {
  const output = effectiveGenerationOutputTokens(model.contextWindow, model.maxTokens);
  return Math.min(MAX_FINAL_REQUEST_BYTES, (model.contextWindow - output) * 4);
};

const stringBytes = (value: string): number => {
  if (value.length > MAX_FINAL_REQUEST_BYTES) return Infinity;
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

/** Incremental UTF-8 JSON size, excluding ONLY direct image blocks' encoded data. */
export const requestTextBytes = (context: Context): number => {
  const images = new WeakSet<object>();
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "toolResult") continue;
    if (Array.isArray(message.content))
      for (const block of message.content) if (block.type === "image") images.add(block);
  }
  const ancestors = new WeakSet<object>();
  let nodes = 262_144;
  const size = (value: unknown, depth: number): number => {
    if (--nodes < 0 || depth > 64) return Infinity;
    if (value === null || value === undefined) return 4;
    if (typeof value === "string") return stringBytes(value);
    if (typeof value === "boolean") return value ? 4 : 5;
    if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;
    if (typeof value !== "object" || ancestors.has(value)) return Infinity;
    ancestors.add(value);
    let bytes = 2;
    if (Array.isArray(value)) {
      bytes += Math.max(0, value.length - 1);
      for (const child of value) {
        bytes += size(child, depth + 1);
        if (bytes > MAX_FINAL_REQUEST_BYTES) return Infinity;
      }
    } else {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return Infinity;
      let fields = 0;
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        bytes += (fields++ > 0 ? 1 : 0) + stringBytes(key) + 1;
        bytes += images.has(value) && key === "data" ? 2 : size(child, depth + 1);
        if (bytes > MAX_FINAL_REQUEST_BYTES) return Infinity;
      }
    }
    ancestors.delete(value);
    return bytes;
  };
  try {
    return size(context, 0);
  } catch {
    return Infinity;
  }
};
