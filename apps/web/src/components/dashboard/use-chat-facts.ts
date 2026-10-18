import { useCallback, useMemo } from "react";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import type { ChatMessage } from "@/lib/chat-api";
import type { MessageFacts } from "./chat-history-ui";

/**
 * Message-scoped projections from the loaded rows.
 *
 * Response facts come from the message's own nullable accounting: never the
 * global chat total and never another attempt's counters. A still-streaming
 * last response is Pending; a completed response without counters stays
 * Unknown instead of inheriting a previous number.
 */
export function useChatFacts(rows: ChatMessage[], live: ChatMessage[], running: boolean) {
  const lastAssistantId = useMemo(() => {
    const loaded = [...rows, ...live];
    for (let index = loaded.length - 1; index >= 0; index -= 1) {
      if (loaded[index]?.role === "assistant") return loaded[index]?.id ?? null;
    }
    return null;
  }, [rows, live]);

  const attachmentsFor = useCallback(
    (messageId: string): ChatFileDescriptor[] => {
      const row = [...rows, ...live].find((item) => item.id === messageId);
      return row?.role === "user" ? row.attachments : [];
    },
    [rows, live],
  );

  const stamps = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of [...rows, ...live]) map.set(row.id, row.createdAt);
    return map;
  }, [rows, live]);

  /** Raw stored stamp only; the runtime's synthesized createdAt is never shown. */
  const stampFor = useCallback((messageId: string) => stamps.get(messageId) ?? "", [stamps]);

  const factsFor = useCallback(
    (messageId: string): MessageFacts => {
      const row = [...rows, ...live].find((item) => item.id === messageId);
      if (row?.role !== "assistant") return { usage: null, pending: false };
      const pending = messageId === lastAssistantId && running;
      return { usage: pending ? null : row.usage, pending };
    },
    [rows, live, lastAssistantId, running],
  );

  return { attachmentsFor, factsFor, stampFor };
}
