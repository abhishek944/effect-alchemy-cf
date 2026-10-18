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
  .middleware(ChatAuthentication) {}
