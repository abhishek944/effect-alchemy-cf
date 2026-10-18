import { Auth } from "@starter/auth";
import { RuntimeContext } from "alchemy";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatNamespaces, doCall, doStream } from "./chat-bindings.ts";
import { chatHeader, decodeOrFail, fail } from "./chat-internal.ts";
import { Chat, ChatUnavailable } from "./chat-model.ts";

/** Snapshot-first SSE relay. Kept outside the JSON group because it streams. */
export const handleChatEvents = Effect.gen(function* () {
  const auth = yield* Auth;
  const ns = yield* ChatNamespaces;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const id = /^\/api\/chats\/([0-9a-fA-F-]{36})\/events$/.exec(new URL(web.url).pathname)?.[1];
  const session = yield* auth.getSession().pipe(
    Effect.mapError(() => new ChatUnavailable()),
    Effect.catchDefect(() => Effect.fail(new ChatUnavailable())),
  );
  if (session === null) return fail(401, "Unauthorized");
  if (id === undefined) return fail(404, "Not found");
  const lookup = yield* doCall(ns.catalog(session.user.id), "GET", `/get?id=${id}`);
  if (lookup.status !== 200) return fail(lookup.status === 404 ? 404 : 503, "Not found");
  const chat = yield* decodeOrFail(Chat, lookup.body);
  return yield* doStream(
    ns.conversation(session.user.id, chat.id),
    "/events",
    chatHeader(chat),
  ).pipe(Effect.map((response) => HttpServerResponse.fromWeb(response)));
}).pipe(
  Effect.provide(RuntimeContext.phantom),
  Effect.catchDefect(() => Effect.succeed(fail(503, "Chat unavailable"))),
  Effect.catch(() => Effect.succeed(fail(503, "Chat unavailable"))),
);
