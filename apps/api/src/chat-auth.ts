import { Auth } from "@starter/auth";
import { RuntimeContext } from "alchemy";
import { Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatForbidden } from "./chat-model.ts";
import { AuthenticationUnavailable, CurrentUser, Unauthorized } from "./model.ts";

/**
 * Authenticates chat traffic, rejects untrusted cross-origin mutations and
 * keeps every chat response out of shared caches.
 */
export class ChatAuthentication extends HttpApiMiddleware.Service<
  ChatAuthentication,
  { provides: CurrentUser }
>()("starter/ChatAuthentication", {
  error: [Unauthorized, ChatForbidden, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    ChatAuthentication,
    Effect.gen(function* () {
      const auth = yield* Auth;
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "GET" && request.method !== "HEAD") {
            const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
            if (web.headers.get("origin") !== new URL(web.url).origin) {
              return yield* Effect.fail(new ChatForbidden());
            }
          }
          const session = yield* auth.getSession().pipe(
            Effect.mapError(() => new AuthenticationUnavailable()),
            Effect.catchDefect(() => Effect.fail(new AuthenticationUnavailable())),
          );
          if (session === null) return yield* Effect.fail(new Unauthorized());
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          }).pipe(
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "no-store"),
            ),
          );
        }).pipe(Effect.provide(RuntimeContext.phantom));
    }),
  );
}
