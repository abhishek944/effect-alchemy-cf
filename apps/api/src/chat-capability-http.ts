import { Effect, Schema } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { ChatNamespaces, doCall, type DoCall } from "./chat-bindings.ts";
import { ChatCatalog } from "./chat-capability-policy.ts";
import { ChatPreferenceConflict } from "./chat-capability-api.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import { chatHeader, decodeOption, decodeOrFail } from "./chat-internal.ts";
import { ChatInvalid, ChatNotFound, ChatUnavailable } from "./chat-model.ts";
import {
  AccountChatPreferencesView,
  ChatPreferencesView,
  ChatPreferencesWriteResult,
} from "./chat-preference-schema.ts";
import { SpeechPreferencesView } from "./chat-speech-schema.ts";
import { ChatUsage } from "./chat-usage-schema.ts";
import { CurrentUser } from "./model.ts";

const Failure = Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(500)) });
const check = Effect.fnUntraced(function* (call: DoCall) {
  if (call.status === 200) return call;
  const message = decodeOption(Failure, call.body)?.message ?? "Chat settings unavailable.";
  if (call.status === 409) return yield* Effect.fail(new ChatPreferenceConflict({ message }));
  if (call.status === 400) return yield* Effect.fail(new ChatInvalid({ message }));
  if (call.status === 404) return yield* Effect.fail(new ChatNotFound());
  return yield* Effect.fail(new ChatUnavailable());
});

export const ChatCapabilitiesLive = HttpApiBuilder.group(Api, "chatCapabilities", (handlers) =>
  Effect.gen(function* () {
    const ns = yield* ChatNamespaces;
    const catalog = Effect.fnUntraced(function* (method: string, path: string, body?: unknown) {
      const user = yield* CurrentUser;
      return yield* doCall(ns.catalog(user.id), method, path, body).pipe(Effect.flatMap(check));
    });
    return handlers
      .handle("chatCapabilities", () =>
        catalog("GET", "/capabilities").pipe(
          Effect.flatMap((call) => decodeOrFail(ChatCatalog, call.body)),
        ),
      )
      .handle("accountChatPreferences", () =>
        catalog("GET", "/preferences/account").pipe(
          Effect.flatMap((call) => decodeOrFail(AccountChatPreferencesView, call.body)),
        ),
      )
      .handle("chatPreferences", ({ params }) =>
        catalog("GET", `/preferences/chat?id=${params.id}`).pipe(
          Effect.flatMap((call) => decodeOrFail(ChatPreferencesView, call.body)),
        ),
      )
      .handle("writeChatPreferences", ({ params, payload }) =>
        Effect.gen(function* () {
          if (params.id !== payload.chatId)
            return yield* Effect.fail(
              new ChatInvalid({ message: "Chat identity does not match." }),
            );
          const call = yield* catalog("PATCH", "/preferences/chat", payload);
          return yield* decodeOrFail(ChatPreferencesWriteResult, call.body);
        }),
      )
      .handle("speechPreferences", () =>
        catalog("GET", "/preferences/speech").pipe(
          Effect.flatMap((call) => decodeOrFail(SpeechPreferencesView, call.body)),
        ),
      )
      .handle("writeSpeechPreferences", ({ payload }) =>
        catalog("PATCH", "/preferences/speech", payload).pipe(
          Effect.flatMap((call) => decodeOrFail(SpeechPreferencesView, call.body)),
        ),
      )
      .handle("chatUsage", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const chat = yield* requireOwnedChat(ns, user.id, params.id);
          const saved = yield* catalog("GET", `/preferences/chat?id=${chat.id}`);
          const preferences = yield* decodeOrFail(ChatPreferencesView, saved.body);
          const call = yield* doCall(
            ns.conversation(user.id, chat.id),
            "GET",
            "/usage",
            undefined,
            {
              ...chatHeader(chat),
              "x-chat-selection": encodeURIComponent(
                JSON.stringify(preferences.preferences.preferred),
              ),
            },
          );
          yield* check(call);
          return yield* decodeOrFail(ChatUsage, call.body);
        }),
      );
  }),
);
