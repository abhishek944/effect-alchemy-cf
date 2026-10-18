import { request, unexpectedResponse } from "@/lib/chat-api";
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
  const page = parseHistoryPage(
    await request(`${path(id, "/history")}?${query.toString()}`, { signal }),
  );
  if (!page) throw unexpectedResponse();
  return page;
}

/** Exact next text slice for one message/revision, resuming from `cursor`. */
export async function getMessageText(
  id: string,
  messageId: string,
  cursor: string,
  signal: AbortSignal,
): Promise<TextPage> {
  const query = new URLSearchParams({ cursor });
  const page = parseTextPage(
    await request(
      `${path(id, `/messages/${encodeURIComponent(messageId)}/text`)}?${query.toString()}`,
      { signal },
    ),
  );
  if (!page) throw unexpectedResponse();
  return page;
}

/** Exact native receipt for one operation UUID, without another submission. */
export async function getOperationReceipt(
  id: string,
  operationId: string,
  signal: AbortSignal,
): Promise<OperationReceipt> {
  const receipt = parseOperationReceipt(
    await request(path(id, `/operations/${encodeURIComponent(operationId)}`), { signal }),
  );
  if (!receipt) throw unexpectedResponse();
  return receipt;
}
