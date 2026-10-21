import { Auth } from "@starter/auth";
import {
  OfficeSessionEpochs,
  resolveOfficeSession,
  type OfficeSession,
} from "@starter/auth/office-session";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { RuntimeContext } from "alchemy";
import { Config, Context, Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { AuthenticationUnavailable, Unauthorized } from "./model.ts";

/** Internal request capability; never serialize it or treat its fields as a native grant. */
export class CurrentOfficeSession extends Context.Service<CurrentOfficeSession, OfficeSession>()(
  "starter/CurrentOfficeSession",
) {}

export class OfficeAuthentication extends HttpApiMiddleware.Service<
  OfficeAuthentication,
  {
    provides: CurrentOfficeSession;
  }
>()("starter/OfficeAuthentication", {
  error: [Unauthorized, AuthenticationUnavailable, OfficeForbidden],
}) {
  static readonly layer = Layer.effect(
    OfficeAuthentication,
    Effect.gen(function* () {
      const auth = yield* Auth;
      const epochs = yield* OfficeSessionEpochs;
      const stage = yield* Config.String("OBS_STAGE");
      return (httpEffect) =>
        Effect.gen(function* () {
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
            Effect.catchTag("OfficeSessionUnavailable", () =>
              Effect.fail(new AuthenticationUnavailable()),
            ),
          );
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentOfficeSession, session),
            Effect.map((response) =>
              HttpServerResponse.setHeader(response, "cache-control", "private, no-store"),
            ),
          );
        }).pipe(Effect.provide(RuntimeContext.phantom));
    }),
  ).pipe(Layer.provide(OfficeSessionEpochs.layer));
}
