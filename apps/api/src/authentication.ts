import { ClerkIdentity } from "@highchat/auth";
import { toAuthenticationRequest } from "@highchat/platform";
import { Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { authUnavailableEffect } from "./auth-failure.ts";
import { AuthenticationUnavailable, CurrentUser, Unauthorized } from "./model.ts";

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("highchat/Authentication", {
  error: [Unauthorized, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    Authentication,
    Effect.gen(function* () {
      const identity = yield* ClerkIdentity;
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const web = yield* toAuthenticationRequest(request).pipe(Effect.orDie);
          const current = yield* identity.current(web).pipe(
            Effect.catchTag("Unauthenticated", () => Effect.fail(new Unauthorized())),
            Effect.catchTag("IdentityUnavailable", (cause) =>
              authUnavailableEffect("auth.identity", cause),
            ),
          );
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            id: current.id,
            name: current.name,
            email: current.email,
          });
        });
    }),
  );
}
