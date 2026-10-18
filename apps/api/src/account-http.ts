/**
 * Public handlers for the profile and account-theme JSON routes.
 *
 * The authenticated session supplies the owner and the one-time seed name; the
 * browser never sends either. Expected failures travel as typed HTTP errors so
 * the client can distinguish a revision conflict from invalid input without
 * parsing prose.
 */
import { Effect, Schema } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { ChatNamespaces, doCall, type DoCall } from "./chat-bindings.ts";
import { ChatPreferenceConflict } from "./chat-capability-api.ts";
import { decodeOption, decodeOrFail } from "./chat-internal.ts";
import { ChatInvalid, ChatNotFound, ChatUnavailable } from "./chat-model.ts";
import { ProfileResponse } from "./profile-model.ts";
import { ThemeResponse } from "./theme-model.ts";
import { CurrentUser } from "./model.ts";

const Failure = Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(500)) });

const check = Effect.fnUntraced(function* (call: DoCall) {
  if (call.status === 200) return call;
  const message = decodeOption(Failure, call.body)?.message ?? "Account settings unavailable.";
  if (call.status === 409) return yield* Effect.fail(new ChatPreferenceConflict({ message }));
  if (call.status === 400 || call.status === 410)
    return yield* Effect.fail(new ChatInvalid({ message }));
  if (call.status === 404) return yield* Effect.fail(new ChatNotFound());
  return yield* Effect.fail(new ChatUnavailable());
});

export const AccountLive = HttpApiBuilder.group(Api, "account", (handlers) =>
  Effect.gen(function* () {
    const ns = yield* ChatNamespaces;
    const catalog = Effect.fnUntraced(function* (
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) {
      const user = yield* CurrentUser;
      const seed = encodeURIComponent(user.name);
      return yield* doCall(ns.catalog(user.id), method, path, body, {
        "x-profile-seed": seed,
        ...headers,
      }).pipe(Effect.flatMap(check));
    });
    return handlers
      .handle("profile", () =>
        catalog("GET", "/profile").pipe(
          Effect.flatMap((call) => decodeOrFail(ProfileResponse, call.body)),
        ),
      )
      .handle("writeProfile", ({ payload }) =>
        catalog("PATCH", "/profile", payload).pipe(
          Effect.flatMap((call) => decodeOrFail(ProfileResponse, call.body)),
        ),
      )
      .handle("accountTheme", () =>
        catalog("GET", "/theme").pipe(
          Effect.flatMap((call) => decodeOrFail(ThemeResponse, call.body)),
        ),
      )
      .handle("writeAccountTheme", ({ payload }) =>
        catalog("PUT", "/theme", payload).pipe(
          Effect.flatMap((call) => decodeOrFail(ThemeResponse, call.body)),
        ),
      );
  }),
);
