import { ClerkIdentity } from "@highchat/auth";
import { Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatForbidden } from "./chat-model.ts";
import { authUnavailableEffect } from "./auth-failure.ts";
import { AuthenticationUnavailable, CurrentUser, Unauthorized } from "./model.ts";

/**
 * Authenticates chat traffic, rejects untrusted cross-origin mutations and
 * keeps every chat response out of shared caches.
 */
export class ChatAuthentication extends HttpApiMiddleware.Service<
  ChatAuthentication,
  { provides: CurrentUser }
>()("highchat/ChatAuthentication", {
  error: [Unauthorized, ChatForbidden, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    ChatAuthentication,
    Effect.gen(function* () {
      const identity = yield* ClerkIdentity;
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
          if (request.method !== "GET" && request.method !== "HEAD") {
            if (web.headers.get("origin") !== new URL(web.url).origin) {
              return yield* Effect.fail(new ChatForbidden());
            }
          }
          const current = yield* identity.current(web).pipe(
            Effect.catchTag("Unauthenticated", () => Effect.fail(new Unauthorized())),
            Effect.catchTag("IdentityUnavailable", (cause) =>
              authUnavailableEffect("chat.identity", cause),
            ),
          );
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            id: current.id,
            name: current.name,
            email: current.email,
          }).pipe(
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "no-store"),
            ),
          );
        });
    }),
  );
}
