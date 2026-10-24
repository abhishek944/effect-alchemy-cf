import { requestDecoded } from "@/lib/chat-api";
import {
  parseHistoryPage,
  parseOperationReceipt,
  parseTextPage,
} from "@/lib/chat-history-validate";
import type { HistoryPage, OperationReceipt, TextPage } from "@/lib/chat-history-types";

const path = (id: string, suffix: string) => `/api/chats/${encodeURIComponent(id)}${suffix}`;

/** Bounded descending history page; cursor is required and comes from coverage. */
export async function getHistory(
  id: string,
  cursor: string,
  limit: number,
  signal: AbortSignal,
): Promise<HistoryPage> {
  const query = new URLSearchParams({ cursor, limit: String(limit) });
  return requestDecoded(
    `${path(id, "/history")}?${query.toString()}`,
    "chat.history",
    parseHistoryPage,
    { signal },
  );
}

/** Exact next text slice for one message/revision, resuming from `cursor`. */
export async function getMessageText(
  id: string,
  messageId: string,
  cursor: string,
  signal: AbortSignal,
): Promise<TextPage> {
  const query = new URLSearchParams({ cursor });
  return requestDecoded(
    `${path(id, `/messages/${encodeURIComponent(messageId)}/text`)}?${query.toString()}`,
    "chat.message-text",
    parseTextPage,
    { signal },
  );
}

/** Exact native receipt for one operation UUID, without another submission. */
export async function getOperationReceipt(
  id: string,
  operationId: string,
  signal: AbortSignal,
): Promise<OperationReceipt> {
  return requestDecoded(
    path(id, `/operations/${encodeURIComponent(operationId)}`),
    "chat.operation-receipt",
    parseOperationReceipt,
    { signal },
  );
}
