import { Schema } from "effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import {
  HistoryPage,
  HistoryQuery,
  MessageParams,
  OperationParams,
  OperationReceipt,
  TextPage,
  TextQuery,
} from "./chat-contract.ts";
import {
  Accepted,
  Chat,
  ChatArchived,
  ChatBusy,
  ChatForbidden,
  ChatIdParams,
  ChatInvalid,
  ChatNotFound,
  ChatRateLimited,
  ChatSnapshot,
  ChatUnavailable,
  CreateChat,
  InferenceUnavailable,
  PatchChat,
  SendMessage,
  StopChat,
  Stopped,
  SubmissionFailed,
  RefreshRequired,
} from "./chat-model.ts";
import {
  SkillAttemptAccepted,
  SkillAttemptNoAdmission,
  SkillNewSendRequest,
  SkillRetryRequest,
} from "./skills-model.ts";

/** Side-effect-free readiness response; values are strictly bounded. */
export const SkillReadinessResponse = Schema.Struct({
  ready: Schema.Boolean,
  message: Schema.String.check(Schema.isMaxLength(256)),
  revision: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  files: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 32 })),
});

export class ChatApi extends HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.get("listChats", "/api/chats", {
      success: Schema.Struct({ chats: Schema.Array(Chat) }),
      error: [ChatForbidden, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post("createChat", "/api/chats", {
      payload: CreateChat,
      success: Chat,
      error: [ChatForbidden, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.patch("patchChat", "/api/chats/:id", {
      params: ChatIdParams,
      payload: PatchChat,
      success: Chat,
      error: [ChatForbidden, ChatNotFound, ChatInvalid, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get("chatSnapshot", "/api/chats/:id", {
      params: ChatIdParams,
      success: ChatSnapshot,
      error: [ChatForbidden, ChatNotFound, ChatInvalid, RefreshRequired, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get("chatHistory", "/api/chats/:id/history", {
      params: ChatIdParams,
      query: HistoryQuery,
      success: HistoryPage,
      error: [ChatForbidden, ChatNotFound, ChatInvalid, RefreshRequired, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get("chatText", "/api/chats/:id/messages/:messageId/text", {
      params: MessageParams,
      query: TextQuery,
      success: TextPage,
      error: [ChatForbidden, ChatNotFound, ChatInvalid, RefreshRequired, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get("chatReceipt", "/api/chats/:id/operations/:operationId", {
      params: OperationParams,
      success: OperationReceipt,
      error: [ChatForbidden, ChatNotFound, ChatInvalid, RefreshRequired, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post("sendMessage", "/api/chats/:id/messages", {
      params: ChatIdParams,
      payload: SendMessage,
      success: Accepted,
      error: [
        ChatForbidden,
        ChatNotFound,
        ChatBusy,
        ChatArchived,
        ChatInvalid,
        ChatRateLimited,
        InferenceUnavailable,
        SubmissionFailed,
        ChatUnavailable,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("stopChat", "/api/chats/:id/stop", {
      params: ChatIdParams,
      payload: StopChat,
      success: Stopped,
      error: [ChatForbidden, ChatNotFound, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get("skillReadiness", "/api/chats/:id/skills/readiness", {
      params: ChatIdParams,
      success: SkillReadinessResponse,
      error: [ChatForbidden, ChatNotFound, ChatUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post("retrySkill", "/api/chats/:id/skills/retry", {
      params: ChatIdParams,
      payload: SkillRetryRequest,
      success: SkillAttemptAccepted,
      error: [
        SkillAttemptNoAdmission,
        ChatForbidden,
        ChatNotFound,
        ChatBusy,
        ChatArchived,
        ChatInvalid,
        ChatRateLimited,
        InferenceUnavailable,
        SubmissionFailed,
        ChatUnavailable,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("newSkillSend", "/api/chats/:id/skills/new-send", {
      params: ChatIdParams,
      payload: SkillNewSendRequest,
      success: SkillAttemptAccepted,
      error: [
        SkillAttemptNoAdmission,
        ChatForbidden,
        ChatNotFound,
        ChatBusy,
        ChatArchived,
        ChatInvalid,
        ChatRateLimited,
        InferenceUnavailable,
        SubmissionFailed,
        ChatUnavailable,
      ],
    }),
  )
  .middleware(ChatAuthentication) {}
