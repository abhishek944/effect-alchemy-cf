import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { ChatId, ChatMessage, Coverage, OperationId } from "./chat-model.ts";

export class InvalidCursor extends Error {}
export class RefreshFence extends Error {}
export const WINDOW_MESSAGES = 80;
export const HISTORY_DEFAULT_LIMIT = 40;
export const HISTORY_MAX_LIMIT = 80;
export const FRAME_BYTES = 128 * 1024;
export const TEXT_BYTES = 32 * 1024;
export const TEXT_PREVIEW_UNITS = 512;
export const MAX_ENTRY_FETCHES = 16;
export const MAX_MODEL_CANDIDATES = 80;
export const MAX_BLOCK_VISITS = 128;
export const CURSOR_MAX_BYTES = 2048;
export const encodedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const HistoryPage = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  history: Coverage,
});
export type HistoryPage = typeof HistoryPage.Type;
export const TextPage = Schema.Struct({
  messageId: Schema.String,
  textRevision: Schema.String,
  text: Schema.String,
  nextCursor: Schema.NullOr(Schema.String),
});
export type TextPage = typeof TextPage.Type;
export const OperationReceipt = Schema.Struct({
  operationId: OperationId,
  accepted: Schema.Boolean,
  settled: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type OperationReceipt = typeof OperationReceipt.Type;
export const MessageParams = Schema.Struct({
  id: ChatId,
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
export const OperationParams = Schema.Struct({ id: ChatId, operationId: OperationId });
const CursorInput = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(CURSOR_MAX_BYTES),
);
export const HistoryQuery = Schema.Struct({
  cursor: CursorInput,
  limit: Schema.optional(Schema.String.check(Schema.isMaxLength(16))),
});
export const TextQuery = Schema.Struct({ cursor: Schema.optional(CursorInput) });
const Index = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
const Id = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0));
export const NativeDescending = Schema.Struct({ after: Id, order: Schema.Literal("descending") });
export const HistoryCursor = Schema.Struct({
  v: Schema.Literal(1),
  k: Schema.Literal("h"),
  chat: ChatId,
  ceiling: Id,
  after: Schema.NullOr(NativeDescending),
  entry: Schema.NullOr(Id),
  index: Schema.NullOr(Index),
});
export type HistoryCursor = typeof HistoryCursor.Type;
export const TextCursor = Schema.Struct({
  v: Schema.Literal(1),
  k: Schema.Literal("t"),
  chat: ChatId,
  message: MessageParams.fields.messageId,
  revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  block: Index,
  offset: Index,
});
export type TextCursor = typeof TextCursor.Type;
const encode = (value: unknown): string =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const exactKeys = (value: unknown, keys: readonly string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const decode = (raw: string): unknown => {
  if (raw.length > CURSOR_MAX_BYTES || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/")));
    return parsed;
  } catch {
    return null;
  }
};
export const encodeHistoryCursor = (cursor: HistoryCursor): string => encode(cursor);
export const encodeTextCursor = (cursor: TextCursor): string => encode(cursor);
export const decodeHistoryCursor = (chatId: string, raw: string): HistoryCursor | null => {
  const value = decode(raw);
  if (!exactKeys(value, ["v", "k", "chat", "ceiling", "after", "entry", "index"])) return null;
  const parsed = decodeOption(HistoryCursor, value);
  if (parsed === null || parsed.chat !== chatId) return null;
  if (
    parsed.after !== null &&
    (!exactKeys(parsed.after, ["after", "order"]) || parsed.after.after > parsed.ceiling)
  )
    return null;
  if ((parsed.entry === null) !== (parsed.index === null)) return null;
  if (
    parsed.entry !== null &&
    (parsed.entry > parsed.ceiling || (parsed.after !== null && parsed.entry >= parsed.after.after))
  )
    return null;
  if (parsed.entry === null && parsed.after === null) return null;
  return parsed;
};
export const decodeTextCursor = (chatId: string, raw: string): TextCursor | null => {
  const value = decode(raw);
  if (!exactKeys(value, ["v", "k", "chat", "message", "revision", "block", "offset"])) return null;
  const parsed = decodeOption(TextCursor, value);
  return parsed !== null && parsed.chat === chatId ? parsed : null;
};
