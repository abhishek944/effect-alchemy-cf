import type * as cf from "./platform.ts";
import { reportFailureEffect, requestDiagnosticContext } from "@highchat/diagnostics";
import { RuntimeEnv } from "@highchat/platform";
import { Cause, Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatNamespaces } from "./chat-bindings.ts";
import { nativeIdentity } from "./native-auth.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { handleChatFilesRequest, matchChatFilesRoute } from "./chat-files-http.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import { fail } from "./chat-internal.ts";
import { nativeJson, nativeSpeechServices } from "./chat-media-services.ts";
import { handleSpeechRequest, isSpeechOperationPath } from "./chat-speech-handler.ts";

const bucketBinding = (value: unknown): value is cf.R2Bucket =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  typeof value.get === "function" &&
  "head" in value &&
  typeof value.head === "function" &&
  "put" in value &&
  typeof value.put === "function" &&
  "delete" in value &&
  typeof value.delete === "function";

export const isChatMediaPath = (pathname: string): boolean =>
  matchChatFilesRoute(pathname) !== null || isSpeechOperationPath(pathname);

/** Binary/multipart routes authenticate before their own larger bounded body reads. */
export const handleChatMedia = Effect.gen(function* () {
  const ns = yield* ChatNamespaces;
  const env = yield* RuntimeEnv;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const url = new URL(web.url);
  if (web.method !== "GET" && web.method !== "HEAD" && web.headers.get("origin") !== url.origin)
    return fail(403, "This request must come from the application origin.");
  const identity = yield* nativeIdentity;
  if (identity.ownerId === null)
    return identity.outage
      ? fail(503, "Authentication is temporarily unavailable.")
      : fail(401, "Sign in to use chats.");
  const ownerId = identity.ownerId;
  const route = matchChatFilesRoute(url.pathname);
  if (route !== null) {
    const chat = yield* requireOwnedChat(ns, ownerId, route.chatId);
    if (chat.archived && web.method === "POST")
      return fail(409, "Unarchive this chat before adding files.");
    const candidate = env.CHAT_FILES;
    if (!bucketBinding(candidate))
      return fail(503, "Private attachment storage is not configured.");
    const diagnostic = Object.freeze(yield* requestDiagnosticContext);
    const response = yield* Effect.promise(async () => {
      await nativeJson(
        ns.catalog(ownerId),
        "POST",
        "/owner",
        Schema.Struct({ ok: Schema.Literal(true) }),
        { id: ownerId },
      );
      return handleChatFilesRequest({
        request: web,
        diagnostic,
        route,
        ownerId,
        bucket: candidate,
        catalog: createChatFilesCatalogClient(ns.catalog(ownerId)),
      });
    });
    return HttpServerResponse.fromWeb(response);
  }
  if (isSpeechOperationPath(url.pathname)) {
    const response = yield* Effect.promise(() =>
      handleSpeechRequest(
        web,
        {
          userId: ownerId,
          stage: typeof env.OBS_STAGE === "string" ? env.OBS_STAGE : "",
          env,
        },
        nativeSpeechServices(ns, ownerId),
      ),
    );
    return HttpServerResponse.fromWeb(response);
  }
  return fail(404, "Not found.");
}).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : reportFailureEffect(cause, { component: "chat-media", operation: "request" }),
  ),
  Effect.catch(() => Effect.succeed(fail(503, "Chat service unavailable."))),
  Effect.catchDefect(() => Effect.succeed(fail(503, "Chat service unavailable."))),
);
