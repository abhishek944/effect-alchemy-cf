import { reportFailureEffect, withDiagnostic } from "@highchat/diagnostics";
import { Cause, Effect } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatNamespaces, doCall, doStream } from "./chat-bindings.ts";
import { nativeIdentity } from "./native-auth.ts";
import { privateUnavailable } from "./chat-diagnostics.ts";
import { chatHeader, decodeOrFail, fail } from "./chat-internal.ts";
import { Chat, ChatUnavailable } from "./chat-model.ts";

/** Snapshot-first SSE relay. Kept outside the JSON group because it streams. */
export const handleChatEvents = Effect.gen(function* () {
  const ns = yield* ChatNamespaces;
  const identity = yield* nativeIdentity;
  const web = identity.web;
  const id = /^\/api\/chats\/([0-9a-fA-F-]{36})\/events$/.exec(new URL(web.url).pathname)?.[1];
  if (identity.ownerId === null)
    return identity.outage ? yield* Effect.fail(new ChatUnavailable()) : fail(401, "Unauthorized");
  const ownerId = identity.ownerId;
  if (id === undefined) return fail(404, "Not found");
  const lookup = yield* doCall(ns.catalog(ownerId), "GET", `/get?id=${id}`);
  if (lookup.status === 404) return fail(404, "Not found");
  if (lookup.status !== 200)
    return yield* reportFailureEffect(privateUnavailable("lookup", lookup.status), {
      component: "chat",
      operation: "events.lookup",
      reason: "lookup",
      status: lookup.status,
    }).pipe(Effect.as(fail(503, "Not found")));
  const chat = yield* decodeOrFail(Chat, lookup.body).pipe(
    Effect.mapError((error) => withDiagnostic(error, "lookup-decode")),
  );
  return yield* doStream(ns.conversation(ownerId, chat.id), "/events", chatHeader(chat)).pipe(
    Effect.map((response) => HttpServerResponse.fromWeb(response)),
  );
}).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : reportFailureEffect(cause, { component: "chat", operation: "events" }),
  ),
  Effect.catchDefect(() => Effect.succeed(fail(503, "Chat unavailable"))),
  Effect.catch(() => Effect.succeed(fail(503, "Chat unavailable"))),
);
