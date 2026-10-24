import { Auth } from "@starter/auth";
import { RuntimeContext } from "alchemy";
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
>()("starter/AdminAuthentication", {
  error: [Unauthorized, Forbidden, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    AdminAuthentication,
    Effect.gen(function* () {
      const auth = yield* Auth;
      return (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "GET") {
            const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
            if (web.headers.get("origin") !== new URL(web.url).origin) {
              return yield* Effect.fail(new Forbidden());
            }
          }
          // No cookie cache: getSession reads the current role from the database.
          const session = yield* auth.getSession().pipe(
            Effect.catch((cause) => authUnavailableEffect("admin.session", cause)),
            Effect.catchDefect((defect) => authUnavailableEffect("admin.session", defect)),
          );
          if (!session) return yield* Effect.fail(new Unauthorized());
          if (session.user.role !== "admin") return yield* Effect.fail(new Forbidden());
          return yield* Effect.provideService(httpEffect, CurrentAdmin, {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            role: "admin",
          }).pipe(
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "no-store"),
            ),
          );
        }).pipe(Effect.provide(RuntimeContext.phantom));
    }),
  );
}
