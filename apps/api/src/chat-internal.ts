import { Effect, Option, Schema } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Chat, ChatId, ChatUnavailable, PatchChat, SendMessage, StopChat } from "./chat-model.ts";

/** Internal server-to-object payloads. These routes are never browser-reachable. */
export const CatalogCreateBody = Schema.Struct({ id: ChatId, now: Schema.String });
export const CatalogPatchBody = Schema.Struct({
  id: ChatId,
  ...PatchChat.fields,
});
export const CatalogTouchBody = Schema.Struct({ id: ChatId });
export const CatalogAdmitBody = Schema.Struct({
  operationId: SendMessage.fields.operationId,
  chatId: ChatId,
  identity: Schema.String.check(Schema.isMaxLength(20000)),
  now: Schema.Number,
  nativeAccepted: Schema.Boolean,
  attemptId: SendMessage.fields.operationId,
});
export const CatalogReleaseBody = Schema.Struct({
  operationId: SendMessage.fields.operationId,
  attemptId: Schema.NullOr(SendMessage.fields.operationId),
});
export const CatalogOperationBody = Schema.Struct({
  operationId: SendMessage.fields.operationId,
  now: Schema.Number,
});
export const CatalogTitleClaimBody = Schema.Struct({
  id: ChatId,
  operationId: SendMessage.fields.operationId,
  text: SendMessage.fields.text,
  identity: Schema.String.check(Schema.isMaxLength(20000)),
  selection: SendMessage.fields.selection,
});
export const ConversationTitleBody = Schema.Struct({
  operationId: SendMessage.fields.operationId,
});
export const FirstInputDecision = Schema.Struct({ first: Schema.Boolean });
export const AdmitDecision = Schema.Struct({
  admitted: Schema.Boolean,
  duplicate: Schema.Boolean,
  reason: Schema.Literals(["accepted", "duplicate", "tentative", "mismatch", "rate", "archived"]),
  attemptId: Schema.NullOr(SendMessage.fields.operationId),
});
export const ChatListResponse = Schema.Struct({ chats: Schema.Array(Chat) });
export const AcceptedResponse = Schema.Struct({ accepted: Schema.Boolean });
export const ConversationSendBody = SendMessage;
export const ConversationStopBody = StopChat;
export const ConversationHistoryBody = Schema.Struct({
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
  limit: Schema.Number,
});
export const ConversationTextBody = Schema.Struct({
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
});
export const ConversationReceiptBody = Schema.Struct({
  operationId: SendMessage.fields.operationId,
});
export const SendFailure = Schema.Struct({
  message: Schema.String,
  code: Schema.Literals(["inference_unconfigured", "submission_failed"]),
});

export const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Internal metadata header, ASCII-encoded so Unicode titles survive the header. */
export const chatHeader = (chat: Chat): Record<string, string> => ({
  "x-chat-json": encodeURIComponent(JSON.stringify(chat)),
});

export const chatFromHeader = (raw: string | null): Chat | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    return decodeOption(Chat, parsed);
  } catch {
    return null;
  }
};

export const isChatPath = (pathname: string): boolean =>
  pathname === "/api/chats" ||
  pathname.startsWith("/api/chats/") ||
  pathname.startsWith("/api/chat/");

/** Safe JSON error response for the non-HttpApi SSE route. */
export const fail = (status: number, message: string) =>
  HttpServerResponse.setHeader(
    HttpServerResponse.text(JSON.stringify({ message }), { status }),
    "cache-control",
    "no-store",
  );

/** Reads a request body as `unknown` so schema decoding owns the narrowing. */
export const requestBody = async (request: Request): Promise<unknown> => {
  const raw: unknown = await request.json();
  return raw;
};

/** Safe sync decode for internal request bodies and headers. */
export const decodeOption = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | null => Option.getOrNull(Schema.decodeUnknownOption(schema)(input));

/** Safe Effect decode for internal object responses. */
export const decodeOrFail = <S extends Schema.Constraint>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError(() => new ChatUnavailable()));

/** Stable content digest that binds an operation id to its submitted text. */
export const digestText = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
