import { ClerkIdentity } from "@highchat/auth";
import { toAuthenticationRequest } from "@highchat/platform";
import { Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CurrentAdmin, Forbidden } from "./admin-model.ts";
import { authUnavailableEffect } from "./auth-failure.ts";
import { AuthenticationUnavailable, Unauthorized } from "./model.ts";

export class AdminAuthentication extends HttpApiMiddleware.Service<
  AdminAuthentication,
  { provides: CurrentAdmin }
>()("highchat/AdminAuthentication", {
  error: [Unauthorized, Forbidden, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    AdminAuthentication,
    Effect.gen(function* () {
      const identity = yield* ClerkIdentity;
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const web = yield* toAuthenticationRequest(request).pipe(Effect.orDie);
          if (request.method !== "GET") {
            if (web.headers.get("origin") !== new URL(web.url).origin) {
              return yield* Effect.fail(new Forbidden());
            }
          }
          // Read every request: a dashboard role change applies immediately.
          const current = yield* identity.current(web).pipe(
            Effect.catchTag("Unauthenticated", () => Effect.fail(new Unauthorized())),
            Effect.catchTag("IdentityUnavailable", (cause) =>
              authUnavailableEffect("admin.identity", cause),
            ),
          );
          if (!current.admin) return yield* Effect.fail(new Forbidden());
          return yield* Effect.provideService(httpEffect, CurrentAdmin, {
            id: current.id,
            name: current.name,
            email: current.email,
            role: "admin",
          }).pipe(
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "no-store"),
            ),
          );
        });
    }),
  );
}
