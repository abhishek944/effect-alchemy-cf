import { Effect } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { HistoryPage, OperationReceipt, TextPage } from "./chat-contract.ts";
import { chatRead, historyLimit, requireOwnedChat } from "./chat-http-read.ts";
import { ChatListResponse, chatHeader, decodeOrFail } from "./chat-internal.ts";
import { Chat, ChatInvalid, ChatNotFound, ChatSnapshot, ChatUnavailable } from "./chat-model.ts";
import { sendChat } from "./chat-send-http.ts";
import { CurrentUser } from "./model.ts";

export const ChatLive = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const ns = yield* ChatNamespaces;
    return handlers
      .handle("listChats", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const call = yield* doCall(ns.catalog(user.id), "GET", "/list");
          if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
          return yield* decodeOrFail(ChatListResponse, call.body);
        }),
      )
      .handle("createChat", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const call = yield* doCall(ns.catalog(user.id), "POST", "/create", {
            id: payload.id,
            now: new Date().toISOString(),
          });
          if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
          return yield* decodeOrFail(Chat, call.body);
        }),
      )
      .handle("patchChat", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          if (payload.title === undefined && payload.archived === undefined)
            return yield* Effect.fail(
              new ChatInvalid({ message: "Provide a title or archive change." }),
            );
          const call = yield* doCall(ns.catalog(user.id), "PATCH", "/patch", {
            id: params.id,
            ...payload,
          });
          if (call.status === 404) return yield* Effect.fail(new ChatNotFound());
          if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
          return yield* decodeOrFail(Chat, call.body);
        }),
      )
      .handle("chatSnapshot", ({ params }) =>
        chatRead(ns, params.id, "/snapshot", undefined, ChatSnapshot),
      )
      .handle("chatHistory", ({ params, query }) =>
        chatRead(
          ns,
          params.id,
          "/history",
          {
            cursor: query.cursor,
            limit: historyLimit(query.limit),
          },
          HistoryPage,
        ),
      )
      .handle("chatText", ({ params, query }) =>
        chatRead(
          ns,
          params.id,
          "/text",
          {
            messageId: params.messageId,
            cursor: query.cursor ?? null,
          },
          TextPage,
        ),
      )
      .handle("chatReceipt", ({ params }) =>
        chatRead(
          ns,
          params.id,
          "/receipt",
          {
            operationId: params.operationId,
          },
          OperationReceipt,
        ),
      )
      .handle("sendMessage", ({ params, payload }) => sendChat(ns, params.id, payload))
      .handle("stopChat", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const chat = yield* requireOwnedChat(ns, user.id, params.id);
          const call = yield* doCall(
            ns.conversation(user.id, chat.id),
            "POST",
            "/stop",
            { operationId: payload.operationId },
            chatHeader(chat),
          );
          if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
          return { ok: true };
        }),
      );
  }),
);
