import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { ToolResultEntry, type EntryRecord, type ToolSlot } from "@earendil-works/pi-durable";
import { encodedBytes } from "./chat-contract.ts";
import { safeToolText, toolInputExcerpt } from "./chat-tool-excerpts.ts";
import {
  TOOL_LIMIT,
  TOOL_PREVIEW_BYTES,
  TOOL_OUTPUT_BYTES,
  type ChatTool,
} from "./chat-tool-schema.ts";

export type ToolResultPreview = {
  name: string;
  status: ChatTool["status"];
  output: string;
  truncated: boolean;
};
export type ToolResults = ReadonlyMap<string, ToolResultPreview | null>;
export const toolResultPreview = (
  entry: EntryRecord,
  message: ToolResultMessage,
  budget: number,
): { result: ToolResultPreview; visited: number } => {
  const diagnostics = ToolResultEntry.is(entry) ? entry.data.diagnostics : [];
  // Native appendToolResult appends exactly one rendered diagnostic block last.
  const length = Math.max(0, message.content.length - (diagnostics.length > 0 ? 1 : 0));
  let output = "";
  let visited = 0;
  let truncated = diagnostics.length > 16;
  let cancelled = false;
  let interrupted = false;
  for (let i = 0; i < Math.min(16, diagnostics.length); i += 1) {
    const code = diagnostics[i]?.code;
    cancelled ||= code === "aborted";
    interrupted ||= code === "interrupted";
    truncated ||= code === "truncated" || code === "interrupted" || code === "aborted";
  }
  for (let i = 0; i < length; i += 1) {
    if (visited >= budget || visited >= 32 || output.length >= TOOL_OUTPUT_BYTES) {
      truncated = true;
      break;
    }
    visited += 1;
    const block = message.content[i];
    if (block?.type !== "text") {
      truncated = true;
      continue;
    }
    const excerpt = safeToolText(
      block.text,
      Math.max(0, TOOL_OUTPUT_BYTES - output.length - (output.length === 0 ? 0 : 1)),
    );
    output += `${output.length === 0 ? "" : "\n"}${excerpt.text}`;
    truncated ||= excerpt.truncated;
  }
  const bounded = safeToolText(output, TOOL_OUTPUT_BYTES);
  return {
    visited,
    result: {
      name: message.toolName,
      status: cancelled
        ? "cancelled"
        : interrupted
          ? "unknown"
          : message.isError
            ? "failed"
            : "succeeded",
      output: bounded.text,
      truncated: truncated || bounded.truncated,
    },
  };
};

/** Walk only public text/tool blocks, retaining native UTF-16 positions and call IDs. */
export const projectPublicTools = (
  message: AssistantMessage,
  results: ToolResults,
  blockBudget: number,
  byteBudget = TOOL_PREVIEW_BYTES,
  slots: readonly ToolSlot[] = [],
  evidenceTruncated = false,
  partial = false,
) => {
  const tools: ChatTool[] = [];
  let textOffset = 0;
  let visited = 0;
  let used = 64;
  let toolsTruncated = evidenceTruncated;
  for (const block of message.content) {
    if (visited >= blockBudget || tools.length >= TOOL_LIMIT) {
      toolsTruncated = true;
      break;
    }
    visited += 1;
    if (block.type === "text") {
      textOffset += block.text.length;
      continue;
    }
    if (block.type !== "toolCall") continue;
    if (!block.id || block.id.length > 256 || !block.name || block.name.length > 128) {
      toolsTruncated = true;
      continue;
    }
    const duplicate = tools.findIndex((tool) => tool.id === block.id);
    const previous = tools[duplicate];
    if (previous !== undefined) {
      tools[duplicate] = { ...previous, status: "unknown", output: null, outputTruncated: true };
      toolsTruncated = true;
      continue;
    }
    const input = toolInputExcerpt(block.arguments, TOOL_OUTPUT_BYTES);
    const result = results.get(block.id);
    const matching = result?.name === block.name ? result : undefined;
    const slot = slots
      .slice(0, TOOL_LIMIT)
      .find((s) => s.callId === block.id && s.name === block.name);
    const liveOutput =
      matching === undefined && slot?.status === "running" ? slot.output : undefined;
    const rawOutput = matching?.output ?? liveOutput;
    const output = rawOutput === undefined ? null : safeToolText(rawOutput, TOOL_OUTPUT_BYTES);
    const tool: ChatTool = {
      id: block.id,
      name: block.name,
      textOffset,
      status:
        matching?.status ??
        (slot?.status === "running"
          ? "running"
          : slot?.status === "pending" || partial
            ? "pending"
            : message.stopReason === "aborted"
              ? "cancelled"
              : "unknown"),
      input: input.text,
      output: output?.text ?? null,
      inputTruncated: input.truncated,
      outputTruncated: matching === undefined || matching.truncated || output?.truncated === true,
    };
    const bytes = encodedBytes(tool) + 1;
    if (used + bytes > Math.min(byteBudget, TOOL_PREVIEW_BYTES)) {
      toolsTruncated = true;
      break;
    }
    used += bytes;
    tools.push(tool);
  }
  return { tools, toolsTruncated, visited };
};
