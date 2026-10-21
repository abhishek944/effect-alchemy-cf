import type { ChatMessage } from "@/lib/chat-api";
import type {
  Coverage,
  HistoryPage,
  OperationReceipt,
  Position,
  TextInfo,
  TextPage,
} from "@/lib/chat-history-types";
import { parseChatFileDescriptor } from "@/lib/chat-capability-file-validate";
import { parseChatUsageAmount } from "@/lib/chat-capability-usage-validate";
import { isIsoDate, isRecord, isSafeIndex, isText, isUuid } from "@/lib/chat-validate-base";

export function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  if (!isSafeIndex(value.entryId) || !isSafeIndex(value.modelIndex)) return null;
  return { entryId: value.entryId, modelIndex: value.modelIndex };
}

export function parseCoverage(value: unknown): Coverage | null {
  if (!isRecord(value)) return null;
  if (value.ceilingEntryId !== null && !isSafeIndex(value.ceilingEntryId)) return null;
  if (value.historyCursor !== null && !isText(value.historyCursor)) return null;
  const through = value.through === null ? null : parsePosition(value.through);
  if (value.through !== null && !through) return null;
  return {
    ceilingEntryId: value.ceilingEntryId,
    through,
    historyCursor: value.historyCursor,
  };
}

export function parseTextInfo(value: unknown): TextInfo | null {
  if (!isRecord(value)) return null;
  if (value.textState !== "complete" && value.textState !== "preview") return null;
  if (!isText(value.textRevision) || !value.textRevision) return null;
  if (value.textCursor !== null && !isText(value.textCursor)) return null;
  return {
    textState: value.textState,
    textRevision: value.textRevision,
    textCursor: value.textCursor,
  };
}

export function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (!isText(value.id) || !value.id) return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  if (!isText(value.text)) return null;
  // Native missing/corrupt time is an empty string, never a fabricated date.
  if (value.createdAt !== "" && !isIsoDate(value.createdAt)) return null;
  if (value.operationId !== null && !isUuid(value.operationId)) return null;
  if (!Array.isArray(value.attachments)) return null;
  if (value.hasGeneratedFiles !== undefined && typeof value.hasGeneratedFiles !== "boolean")
    return null;
  const hasGeneratedFiles = value.hasGeneratedFiles ?? false;
  if (hasGeneratedFiles && value.role !== "assistant") return null;
  if (value.attemptOf !== undefined && value.attemptOf !== null && !isUuid(value.attemptOf))
    return null;
  const attemptOf = value.attemptOf ?? null;
  if (value.incomplete !== undefined && typeof value.incomplete !== "boolean") return null;
  const incomplete = value.incomplete === true;
  const attachments = [];
  for (const item of value.attachments) {
    const file = parseChatFileDescriptor(item);
    if (!file) return null;
    attachments.push(file);
  }
  // Nullable per-message accounting: an invalid present value is rejected, and
  // null stays the honest streaming/unavailable state.
  const usage = value.usage === null ? null : parseChatUsageAmount(value.usage);
  if (value.usage !== null && usage === null) return null;
  const textInfo = parseTextInfo(value);
  if (!textInfo) return null;
  return {
    id: value.id,
    role: value.role,
    text: value.text,
    createdAt: value.createdAt,
    operationId: value.operationId,
    attachments,
    hasGeneratedFiles,
    attemptOf,
    incomplete,
    usage,
    ...textInfo,
  };
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    const message = parseMessage(item);
    if (!message) return null;
    messages.push(message);
  }
  return messages;
}

export function parseHistoryPage(value: unknown): HistoryPage | null {
  if (!isRecord(value)) return null;
  const messages = parseMessages(value.messages);
  const history = parseCoverage(value.history);
  if (!messages || !history) return null;
  return { messages, history };
}

export function parseTextPage(value: unknown): TextPage | null {
  if (!isRecord(value)) return null;
  if (!isText(value.messageId) || !value.messageId) return null;
  if (!isText(value.textRevision) || !value.textRevision) return null;
  if (!isText(value.text)) return null;
  if (value.nextCursor !== null && !isText(value.nextCursor)) return null;
  return {
    messageId: value.messageId,
    textRevision: value.textRevision,
    text: value.text,
    nextCursor: value.nextCursor,
  };
}

export function parseOperationReceipt(value: unknown): OperationReceipt | null {
  if (!isRecord(value)) return null;
  if (!isUuid(value.operationId)) return null;
  if (typeof value.accepted !== "boolean" || typeof value.settled !== "boolean") return null;
  if (value.error !== null && !isText(value.error)) return null;
  return {
    operationId: value.operationId,
    accepted: value.accepted,
    settled: value.settled,
    error: value.error,
  };
}
