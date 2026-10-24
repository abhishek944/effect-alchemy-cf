import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ChatTool } from "@/lib/chat-tool-types";

type Parts = Exclude<ThreadMessageLike["content"], string>;

/** Preserve native text/call order without exposing the provider's raw content. */
export function toolMessageContent(text: string, tools: ChatTool[], isPrefix: boolean): Parts {
  if (!isPrefix) return text ? [{ type: "text", text }] : [];
  const parts: Parts[number][] = [];
  let previousText: { type: "text"; text: string } | undefined;
  let leadingWhitespace = "";
  const appendText = (value: string) => {
    // The SDK drops whitespace-only parts. Retain those exact characters in a
    // neighboring text part, without moving meaningful prose around tool calls.
    if (!value.trim()) {
      if (previousText) previousText.text += value;
      else leadingWhitespace += value;
      return;
    }
    previousText = { type: "text", text: leadingWhitespace + value };
    leadingWhitespace = "";
    parts.push(previousText);
  };
  let offset = 0;
  for (const tool of tools) {
    // Text hydration, not clamping, establishes where this call belongs.
    if (tool.textOffset > text.length) break;
    if (tool.textOffset > offset) appendText(text.slice(offset, tool.textOffset));
    const active = tool.status === "pending" || tool.status === "running";
    parts.push({
      type: "tool-call",
      toolCallId: tool.id,
      toolName: tool.name,
      args: {},
      argsText: tool.input,
      artifact: tool,
      ...(active
        ? { isPreliminary: true }
        : { result: { status: tool.status, output: tool.output } }),
      isError: tool.status === "failed",
    });
    offset = tool.textOffset;
  }
  if (offset < text.length) appendText(text.slice(offset));
  if (leadingWhitespace) parts.push({ type: "text", text: leadingWhitespace });
  return parts;
}
