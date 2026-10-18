import type { Chat, ChatSnapshot } from "@/lib/chat-api";
import { parseCoverage, parseMessage } from "@/lib/chat-history-validate";
import { isIsoDate, isRecord, isText, isUuid } from "@/lib/chat-validate-base";

export function parseChat(value: unknown): Chat | null {
  if (!isRecord(value)) return null;
  if (!isText(value.id) || !value.id) return null;
  if (!isText(value.title)) return null;
  if (typeof value.archived !== "boolean") return null;
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) return null;
  return {
    id: value.id,
    title: value.title,
    archived: value.archived,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseChatList(value: unknown): Chat[] | null {
  if (!isRecord(value) || !Array.isArray(value.chats)) return null;
  const chats: Chat[] = [];
  for (const item of value.chats) {
    const chat = parseChat(item);
    if (!chat) return null;
    chats.push(chat);
  }
  return chats;
}

export function parseSnapshotValue(value: unknown): ChatSnapshot | null {
  if (!isRecord(value)) return null;
  const chat = parseChat(value.chat);
  if (!chat) return null;
  if (!Array.isArray(value.messages)) return null;
  const messages = [];
  for (const item of value.messages) {
    const message = parseMessage(item);
    if (!message) return null;
    messages.push(message);
  }
  const history = parseCoverage(value.history);
  if (!history) return null;
  if (typeof value.isRunning !== "boolean") return null;
  if (value.activeOperationId !== null && !isUuid(value.activeOperationId)) return null;
  if (value.error !== null && !isText(value.error)) return null;
  if (!isText(value.model) || !isText(value.thinking)) return null;
  if (!isText(value.usageRevision)) return null;
  return {
    chat,
    messages,
    history,
    isRunning: value.isRunning,
    activeOperationId: value.activeOperationId,
    error: value.error,
    model: value.model,
    thinking: value.thinking,
    usageRevision: value.usageRevision,
  };
}

export function parseSnapshotJson(data: string): ChatSnapshot | null {
  try {
    return parseSnapshotValue(JSON.parse(data));
  } catch {
    return null;
  }
}

export function parseAccepted(value: unknown): boolean | null {
  if (!isRecord(value) || typeof value.accepted !== "boolean") return null;
  return value.accepted;
}

export function parseOk(value: unknown): boolean {
  return isRecord(value) && value.ok === true;
}
