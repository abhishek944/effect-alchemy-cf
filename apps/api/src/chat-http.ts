import { Effect, Schema } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { SkillReadinessResponse } from "./chat-api.ts";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { HistoryPage, OperationReceipt, TextPage } from "./chat-contract.ts";
import { chatRead, historyLimit, requireOwnedChat } from "./chat-http-read.ts";
import { ChatListResponse, chatHeader, decodeOption, decodeOrFail } from "./chat-internal.ts";
import {
  Chat,
  ChatArchived,
  ChatBusy,
  ChatInvalid,
  ChatNotFound,
  ChatRateLimited,
  ChatSnapshot,
  ChatUnavailable,
  INFERENCE_UNCONFIGURED,
  InferenceUnavailable,
  SUBMISSION_FAILED,
  SubmissionFailed,
} from "./chat-model.ts";
import { sendChat } from "./chat-send-http.ts";
import { CurrentUser } from "./model.ts";
import { SkillAttemptAccepted, SkillAttemptNoAdmission } from "./skills-model.ts";
import { publicApplicationOrigin } from "./chat-public-origin.ts";
const NoAdmissionEnvelope = Schema.Struct({
  operationId: Schema.String.check(Schema.isMaxLength(64)),
  logicalOperationId: Schema.String.check(Schema.isMaxLength(64)),
  terminal: Schema.Literal(true),
  code: Schema.Literal("skills_not_admitted"),
  message: Schema.String.check(Schema.isMaxLength(256)),
});
const FailureEnvelope = Schema.Struct({
  message: Schema.String.check(Schema.isMaxLength(500)),
  code: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
});

export const ChatLive = HttpApiBuilder.group(Api, "chat", (handlers) =>
  Effect.gen(function* () {
    const ns = yield* ChatNamespaces;
    /** Owner-authenticated recovery command; the browser never chooses owner or pin. */
    const skillCommand = (
      id: string,
      path: "/skills/retry" | "/skills/new-send",
      payload: unknown,
      expectedOperationId?: string,
    ) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const chat = yield* requireOwnedChat(ns, user.id, id);
        // No public archive precheck: exact receipt repair may run while archived;
        // the private command refuses NEW admission and reports code archived.
        const applicationOrigin = yield* publicApplicationOrigin;
        const call = yield* doCall(ns.conversation(user.id, chat.id), "POST", path, payload, {
          ...chatHeader(chat),
          "x-chat-owner": user.id,
          "x-chat-application-origin": applicationOrigin,
        });
        if (call.status === 200) return yield* decodeOrFail(SkillAttemptAccepted, call.body);
        const failure = decodeOption(FailureEnvelope, call.body);
        if (call.status === 400)
          return yield* Effect.fail(
            new ChatInvalid({ message: failure?.message ?? "That recovery action is not valid." }),
          );
        if (call.status === 409) {
          const rejection = decodeOption(NoAdmissionEnvelope, call.body);
          if (
            rejection !== null &&
            rejection.operationId === expectedOperationId &&
            rejection.logicalOperationId === expectedOperationId
          )
            return yield* Effect.fail(new SkillAttemptNoAdmission(rejection));
          if (failure?.code === "skills_unrecoverable")
            return yield* Effect.fail(new ChatInvalid({ message: failure.message }));
          if (failure?.code === "archived") return yield* Effect.fail(new ChatArchived());
          return yield* Effect.fail(new ChatBusy());
        }
        if (call.status === 429) return yield* Effect.fail(new ChatRateLimited());
        if (call.status === 503 && failure?.code === "inference_unconfigured")
          return yield* Effect.fail(new InferenceUnavailable({ message: INFERENCE_UNCONFIGURED }));
        if (call.status === 503)
          return yield* Effect.fail(
            new SubmissionFailed({ message: failure?.message ?? SUBMISSION_FAILED }),
          );
        return yield* Effect.fail(new ChatUnavailable());
      });
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
      )
      .handle("skillReadiness", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const chat = yield* requireOwnedChat(ns, user.id, params.id);
          const call = yield* doCall(
            ns.conversation(user.id, chat.id),
            "GET",
            "/skills/readiness",
            undefined,
            { ...chatHeader(chat), "x-chat-owner": user.id },
          );
          if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
          return yield* decodeOrFail(SkillReadinessResponse, call.body);
        }),
      )
      .handle("retrySkill", ({ params, payload }) =>
        skillCommand(params.id, "/skills/retry", payload),
      )
      .handle("newSkillSend", ({ params, payload }) =>
        skillCommand(params.id, "/skills/new-send", payload, payload.operationId),
      );
  }),
);
