import { Effect, Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import { decodeOrFail } from "./chat-internal.ts";
import { LibraryQuery, SavedFile, SavedLibraryPage } from "./chat-library-schema.ts";
import {
  ChatForbidden,
  ChatIdParams,
  ChatInvalid,
  ChatNotFound,
  ChatUnavailable,
} from "./chat-model.ts";
import { CurrentUser } from "./model.ts";

const PublicQuery = Schema.Struct({
  ...LibraryQuery.fields,
  limit: Schema.optional(Schema.String.check(Schema.isPattern(/^(?:[1-9]|[1-4][0-9]|50)$/))),
});
const FileParams = Schema.Struct({ ...ChatIdParams.fields, fileId: DomainUuid });
const errors = [ChatForbidden, ChatNotFound, ChatInvalid, ChatUnavailable];

/** Public saved reads only. Private original authority and generation are not routes in this group. */
export class ChatLibraryApi extends HttpApiGroup.make("chatLibrary")
  .add(
    HttpApiEndpoint.get("listSavedFiles", "/api/chats/:id/files", {
      params: ChatIdParams,
      query: PublicQuery,
      success: SavedLibraryPage,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSavedFile", "/api/chats/:id/files/:fileId", {
      params: FileParams,
      success: SavedFile,
      error: errors,
    }),
  )
  .middleware(ChatAuthentication) {}

// Same identifier/group as parent composition, without a shared root Api import cycle.
const LibraryApi = HttpApi.make("starter").add(ChatLibraryApi);
const PageEnvelope = Schema.Struct({ ok: Schema.Literal(true), value: SavedLibraryPage });
const FileEnvelope = Schema.Struct({ ok: Schema.Literal(true), value: SavedFile });

export const ChatLibraryLive = HttpApiBuilder.group(LibraryApi, "chatLibrary", (handlers) =>
  Effect.gen(function* () {
    const ns = yield* ChatNamespaces;
    const read = Effect.fnUntraced(function* (id: string, path: string) {
      const user = yield* CurrentUser;
      yield* requireOwnedChat(ns, user.id, id);
      // Archive is intentionally not a read prohibition; owner comes only from authentication.
      const call = yield* doCall(ns.catalog(user.id), "GET", path);
      if (call.status === 400)
        return yield* Effect.fail(
          new ChatInvalid({ message: "Invalid saved-file query or cursor." }),
        );
      if (call.status === 404) return yield* Effect.fail(new ChatNotFound());
      if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
      return call.body;
    });
    return handlers
      .handle("listSavedFiles", ({ params, query }) =>
        Effect.gen(function* () {
          const search = new URLSearchParams({ chatId: params.id });
          for (const [key, value] of Object.entries(query))
            if (value !== undefined) search.set(key, value);
          const raw = yield* read(params.id, `/files/library?${search.toString()}`);
          const result = yield* decodeOrFail(PageEnvelope, raw);
          if (
            result.value.chatId !== params.id ||
            result.value.files.some((file) => file.chatId !== params.id)
          )
            return yield* Effect.fail(new ChatUnavailable());
          return result.value;
        }),
      )
      .handle("getSavedFile", ({ params }) =>
        Effect.gen(function* () {
          const search = new URLSearchParams({ chatId: params.id, fileId: params.fileId });
          const raw = yield* read(params.id, `/files/saved?${search.toString()}`);
          const result = yield* decodeOrFail(FileEnvelope, raw);
          if (result.value.chatId !== params.id || result.value.id !== params.fileId)
            return yield* Effect.fail(new ChatUnavailable());
          return result.value;
        }),
      );
  }),
);
