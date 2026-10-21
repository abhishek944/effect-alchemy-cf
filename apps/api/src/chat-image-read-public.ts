import { Effect, Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { AssistantSavedFilesPage } from "./chat-image-call-schema.ts";
import { ImageUsagePresentation } from "./chat-image-presentation.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import { chatHeader, decodeOrFail } from "./chat-internal.ts";
import {
  ChatForbidden,
  ChatIdParams,
  ChatInvalid,
  ChatNotFound,
  ChatUnavailable,
} from "./chat-model.ts";
import { CurrentUser } from "./model.ts";

const MessageId = AssistantSavedFilesPage.fields.messageId;
const MessageParams = Schema.Struct({ ...ChatIdParams.fields, messageId: MessageId });
const FilesQuery = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
});
const UsageQuery = Schema.Struct({ messageId: Schema.optionalKey(MessageId) });
const errors = [ChatForbidden, ChatNotFound, ChatInvalid, ChatUnavailable];

export class ChatImageReadsApi extends HttpApiGroup.make("chatImageReads")
  .add(
    HttpApiEndpoint.get("assistantImageFiles", "/api/chats/:id/messages/:messageId/files", {
      params: MessageParams,
      query: FilesQuery,
      success: AssistantSavedFilesPage,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("chatImageUsage", "/api/chats/:id/images/usage", {
      params: ChatIdParams,
      query: UsageQuery,
      success: ImageUsagePresentation,
      error: errors,
    }),
  )
  .middleware(ChatAuthentication) {}

const ImageReadsApi = HttpApi.make("starter").add(ChatImageReadsApi);
export const ChatImageReadsLive = HttpApiBuilder.group(
  ImageReadsApi,
  "chatImageReads",
  (handlers) =>
    Effect.gen(function* () {
      const ns = yield* ChatNamespaces;
      const read = Effect.fnUntraced(function* (chatId: string, path: string) {
        const user = yield* CurrentUser;
        const chat = yield* requireOwnedChat(ns, user.id, chatId);
        const result = yield* doCall(ns.conversation(user.id, chatId), "GET", path, undefined, {
          ...chatHeader(chat),
          "x-chat-owner": user.id,
        });
        if (result.status === 404) return yield* Effect.fail(new ChatNotFound());
        if (result.status === 400)
          return yield* Effect.fail(
            new ChatInvalid({ message: "Invalid image read query or cursor." }),
          );
        if (result.status !== 200) return yield* Effect.fail(new ChatUnavailable());
        return result.body;
      });
      return handlers
        .handle("assistantImageFiles", ({ params, query }) =>
          Effect.gen(function* () {
            const search = new URLSearchParams({ messageId: params.messageId });
            if (query.cursor !== undefined) search.set("cursor", query.cursor);
            const raw = yield* read(params.id, `/image-files?${search.toString()}`);
            const page = yield* decodeOrFail(AssistantSavedFilesPage, raw);
            if (
              page.messageId !== params.messageId ||
              page.files.some((file) => file.chatId !== params.id)
            )
              return yield* Effect.fail(new ChatUnavailable());
            return page;
          }),
        )
        .handle("chatImageUsage", ({ params, query }) =>
          Effect.gen(function* () {
            const search = new URLSearchParams();
            if (query.messageId !== undefined) search.set("messageId", query.messageId);
            const raw = yield* read(params.id, `/image-usage?${search.toString()}`);
            return yield* decodeOrFail(ImageUsagePresentation, raw);
          }),
        );
    }),
);
