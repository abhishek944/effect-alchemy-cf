import type { ChatTool } from "./chat-tool-types";
import { isRecord, isSafeIndex } from "./chat-validate-base";

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;

export function parseChatTool(value: unknown): ChatTool | null {
  if (!isRecord(value)) return null;
  if (!bounded(value.id, 256) || !value.id || !bounded(value.name, 128) || !value.name) return null;
  const status = value.status;
  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "unknown"
  )
    return null;
  if (!isSafeIndex(value.textOffset) || !bounded(value.input, 50 * 1024)) return null;
  if (value.output !== null && !bounded(value.output, 50 * 1024)) return null;
  if (typeof value.inputTruncated !== "boolean" || typeof value.outputTruncated !== "boolean")
    return null;
  return {
    id: value.id,
    name: value.name,
    status,
    textOffset: value.textOffset,
    input: value.input,
    output: value.output,
    inputTruncated: value.inputTruncated,
    outputTruncated: value.outputTruncated,
  };
}

export function parseChatTools(value: unknown): ChatTool[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) return null;
  const tools: ChatTool[] = [];
  const ids = new Set<string>();
  let offset = 0;
  for (const item of value) {
    const tool = parseChatTool(item);
    if (!tool || ids.has(tool.id) || tool.textOffset < offset) return null;
    ids.add(tool.id);
    offset = tool.textOffset;
    tools.push(tool);
  }
  return tools;
}
