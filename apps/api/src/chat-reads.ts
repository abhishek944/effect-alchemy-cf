import {
  FRAME_BYTES,
  HISTORY_MAX_LIMIT,
  decodeHistoryCursor,
  decodeTextCursor,
  encodedBytes,
} from "./chat-contract.ts";
import {
  ConversationHistoryBody,
  ConversationReceiptBody,
  ConversationTextBody,
  decodeOption,
  json,
  requestBody,
} from "./chat-internal.ts";
import { buildWindow } from "./chat-projection.ts";
import { buildReceipt } from "./chat-receipt.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import { InvalidCursor, RefreshFence, type ChatSource } from "./chat-source.ts";
import { committedText } from "./chat-text.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import type { Chat } from "./chat-model.ts";
export const readChat = async (
  request: Request,
  path: string,
  chat: Chat,
  runtime: ChatRuntime,
  source: ChatSource,
  ledger: ChatLedger,
  hasGeneratedFiles: (entryId: number, modelIndex: number) => boolean = () => false,
): Promise<Response | null> => {
  if (request.method !== "POST" || !["/history", "/text", "/receipt"].includes(path)) return null;
  const raw = await requestBody(request);
  if (path === "/receipt") {
    const body = decodeOption(ConversationReceiptBody, raw);
    if (body === null) return json({ message: "Invalid request" }, 400);
    const record = await runtime.receiptRecord(body.operationId);
    return json(buildReceipt(body.operationId, record, ledger.statusOf(body.operationId)));
  }
  if (path === "/history") {
    const body = decodeOption(ConversationHistoryBody, raw);
    if (body === null || body.cursor === null || !Number.isFinite(body.limit))
      return json({ message: "Invalid request" }, 400);
    const cursor = decodeHistoryCursor(chat.id, body.cursor);
    if (cursor === null) return json({ message: "Invalid cursor" }, 400);
    try {
      const page = await buildWindow(
        await runtime.conversation(),
        chat,
        PI_BACKGROUND,
        cursor,
        Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.trunc(body.limit))),
        (entry) => runtime.publicInput(entry),
        undefined,
        undefined,
        undefined,
        hasGeneratedFiles,
      );
      if (encodedBytes(page) > FRAME_BYTES) throw new Error("History budget exceeded");
      return json(page);
    } catch (error) {
      if (error instanceof InvalidCursor) return json({ message: "Invalid cursor" }, 400);
      throw error;
    }
  }
  const body = decodeOption(ConversationTextBody, raw);
  if (body === null) return json({ message: "Invalid request" }, 400);
  const cursor = body.cursor === null ? null : decodeTextCursor(chat.id, body.cursor);
  if (body.cursor !== null && cursor === null) return json({ message: "Invalid cursor" }, 400);
  if (cursor !== null && cursor.message !== body.messageId)
    return json({ message: "Invalid cursor" }, 400);
  if (body.messageId.startsWith("live:")) {
    try {
      return json(await source.text(chat, body.messageId, cursor));
    } catch (error) {
      if (error instanceof RefreshFence) return json({ message: "Refresh required" }, 409);
      if (error instanceof InvalidCursor) return json({ message: "Invalid cursor" }, 400);
      throw error;
    }
  }
  try {
    const page = await committedText(chat.id, body.messageId, cursor, (entry) =>
      runtime.entryFor(entry),
    );
    if (page === null) return json({ message: "Not found" }, 404);
    return json(page);
  } catch (error) {
    if (error instanceof InvalidCursor) return json({ message: "Invalid cursor" }, 400);
    throw error;
  }
};
