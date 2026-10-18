import { Auth } from "@starter/auth";
import { findUserByEmail, setUserRole } from "@starter/auth/admin-users";
import { RuntimeContext } from "alchemy";
import { Effect } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { CurrentAdmin, Forbidden, UserNotFound } from "./admin-model.ts";
import { AuthenticationUnavailable } from "./model.ts";

export const AdminLive = HttpApiBuilder.group(Api, "admin", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    return handlers
      .handle("adminMe", () => CurrentAdmin)
      .handle("searchUsers", ({ payload }) =>
        findUserByEmail(payload.email).pipe(
          Effect.map((user) => ({ user })),
          Effect.mapError(() => new AuthenticationUnavailable()),
          Effect.provideService(Auth, auth),
          Effect.provide(RuntimeContext.phantom),
        ),
      )
      .handle("setRole", ({ params, payload }) =>
        Effect.gen(function* () {
          const current = yield* CurrentAdmin;
          // Keep an operator from accidentally locking themselves out.
          if (current.id === params.id && payload.role !== "admin") {
            return yield* Effect.fail(new Forbidden());
          }
          const found = yield* setUserRole(params.id, payload.role).pipe(
            Effect.mapError(() => new AuthenticationUnavailable()),
          );
          if (!found) return yield* Effect.fail(new UserNotFound());
          return { ok: true };
        }).pipe(Effect.provideService(Auth, auth), Effect.provide(RuntimeContext.phantom)),
      );
  }),
);
