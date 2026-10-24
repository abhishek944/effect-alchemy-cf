import { Auth } from "@starter/auth";
import {
  OfficeSessionEpochs,
  resolveOfficeSession,
  type OfficeSession,
} from "@starter/auth/office-session";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { RuntimeContext } from "alchemy";
import { Config, Context, Effect, Layer } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { type AuthenticationUnavailable, Unauthorized } from "./model.ts";
import { authUnavailableEffect } from "./auth-failure.ts";

/** Internal request capability; never serialize it or treat its fields as a native grant. */
export class CurrentOfficeSession extends Context.Service<CurrentOfficeSession, OfficeSession>()(
  "starter/CurrentOfficeSession",
) {}

type Authenticate = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E | Unauthorized | AuthenticationUnavailable | OfficeForbidden,
  Exclude<R, CurrentOfficeSession> | HttpServerRequest.HttpServerRequest
>;

export class OfficeAuthentication extends Context.Service<
  OfficeAuthentication,
  { readonly authenticate: Authenticate }
>()("starter/OfficeAuthentication") {
  static readonly layer = Layer.effect(
    OfficeAuthentication,
    Effect.gen(function* () {
      const auth = yield* Auth;
      const epochs = yield* OfficeSessionEpochs;
      const authenticate: Authenticate = (httpEffect) =>
        Effect.gen(function* () {
          const stage = yield* Config.String("OBS_STAGE").pipe(Effect.orDie);
          const request = yield* HttpServerRequest.HttpServerRequest;
          const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
          const origin = web.headers.get("origin");
          const upgrade = web.headers.get("upgrade")?.toLowerCase() === "websocket";
          const requiresOrigin = upgrade || (request.method !== "GET" && request.method !== "HEAD");
          if ((requiresOrigin || origin !== null) && origin !== new URL(web.url).origin)
            return yield* Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN")));
          const session = yield* resolveOfficeSession(stage, web.headers).pipe(
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
            Effect.catchTag("OfficeSessionDenied", () => Effect.fail(new Unauthorized())),
            Effect.catchTag("OfficeSessionUnavailable", (cause) =>
              authUnavailableEffect("office.session", cause),
            ),
          );
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentOfficeSession, session),
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "private, no-store"),
            ),
          );
        }).pipe(Effect.provide(RuntimeContext.phantom));
      return { authenticate };
    }),
  ).pipe(Layer.provide(OfficeSessionEpochs.layer));
}
