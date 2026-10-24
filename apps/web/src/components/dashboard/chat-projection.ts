import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { ChatMessage } from "@/lib/chat-api";
import type { PendingSend } from "@/lib/chat-store-context";
import { storedDate } from "@/lib/chat-time";
import { toolMessageContent } from "./chat-tool-projection";

export function convertMessage(message: ThreadMessageLike): ThreadMessageLike {
  return message;
}

export function appendText(message: AppendMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

type TextReader = (row: ChatMessage) => { text: string; isPrefix?: boolean };

/**
 * Projects the merged bounded history plus the latest live row into the
 * assistant-ui runtime. Text comes from the exact loaded prefix or fetched
 * chunk for that message/revision, never a synthesized or truncated join. The
 * optimistic user message stays until a row with the exact operation UUID is
 * present, so unrelated runs, other tabs or repeated text cannot hide it. A
 * missing stored time stays absent; the runtime never receives a fabricated
 * current time.
 */
export function projectMessages(
  rows: ChatMessage[],
  live: ChatMessage[],
  pending: PendingSend | null,
  selectedId: string | null,
  textFor: TextReader,
): ThreadMessageLike[] {
  if (!selectedId) return [];
  const projected: ThreadMessageLike[] = [...rows, ...live].map((message) => {
    const createdAt = storedDate(message.createdAt);
    const text = textFor(message);
    const tools = message.role === "assistant" ? (message.tools ?? []) : [];
    const isPrefix = text.isPrefix !== false;
    return {
      id: message.id,
      role: message.role,
      content: tools.length ? toolMessageContent(text.text, tools, isPrefix) : text.text,
      // Empty tool-calling assistant rows still own their persisted image receipts.
      metadata: {
        custom: {
          hasGeneratedFiles: message.hasGeneratedFiles,
          attemptOf: message.attemptOf,
          incomplete: message.incomplete,
          toolsTruncated: message.toolsTruncated === true,
          toolsDeferred: isPrefix && tools.some((tool) => tool.textOffset > text.text.length),
          toolPositionsUnavailable: !isPrefix && tools.length > 0,
        },
      },
      ...(createdAt ? { createdAt } : {}),
    };
  });
  if (!pending || pending.chatId !== selectedId) return projected;
  const committed = [...rows, ...live].some(
    (message) => message.operationId === pending.operationId,
  );
  if (!committed) {
    projected.push({
      id: `pending-${pending.operationId}`,
      role: "user",
      content: pending.text,
      metadata: { isOptimistic: true },
    });
  }
  return projected;
}
