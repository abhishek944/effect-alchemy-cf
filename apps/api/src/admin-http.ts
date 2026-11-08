import { ClerkAdminUsers } from "@highchat/auth/admin-users";
import { Effect } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { CurrentAdmin, Forbidden, UserNotFound } from "./admin-model.ts";
import { authUnavailableEffect } from "./auth-failure.ts";

export const AdminLive = HttpApiBuilder.group(Api, "admin", (handlers) =>
  Effect.gen(function* () {
    const users = yield* ClerkAdminUsers;
    return handlers
      .handle("adminMe", () => CurrentAdmin)
      .handle("searchUsers", ({ payload }) =>
        users.findByEmail(payload.email).pipe(
          Effect.map((user) => ({ user })),
          Effect.catch((cause) => authUnavailableEffect("admin.users.search", cause)),
        ),
      )
      .handle("setRole", ({ params, payload }) =>
        Effect.gen(function* () {
          const current = yield* CurrentAdmin;
          // Keep an operator from accidentally locking themselves out.
          if (current.id === params.id && payload.role !== "admin") {
            return yield* Effect.fail(new Forbidden());
          }
          const found = yield* users
            .setRole(params.id, payload.role)
            .pipe(Effect.catch((cause) => authUnavailableEffect("admin.users.setRole", cause)));
          if (!found) return yield* Effect.fail(new UserNotFound());
          return { ok: true };
        }),
      );
  }),
);
