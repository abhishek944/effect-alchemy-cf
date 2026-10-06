import { Auth } from "@starter/auth";
import { RuntimeContext } from "alchemy";
import { Effect, Layer } from "effect";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import { AuthenticationUnavailable, CurrentUser, Unauthorized } from "./model.ts";

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("starter/Authentication", {
  error: [Unauthorized, AuthenticationUnavailable],
}) {
  static readonly layer = Layer.effect(
    Authentication,
    Effect.gen(function* () {
      const auth = yield* Auth;
      return (httpEffect) =>
        Effect.gen(function* () {
          const session = yield* auth.getSession().pipe(
            Effect.mapError(() => new AuthenticationUnavailable()),
            Effect.catchDefect(() => Effect.fail(new AuthenticationUnavailable())),
          );
          if (session === null) return yield* Effect.fail(new Unauthorized());
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          });
        }).pipe(Effect.provide(RuntimeContext.phantom));
    }),
  );
}
