import * as Http from "alchemy/Http";
import { Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { AccountLive } from "./account-http.ts";
import { AdminAuthentication } from "./admin-authentication.ts";
import { AdminLive } from "./admin-http.ts";
import { Api } from "./api.ts";
import { Authentication } from "./authentication.ts";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatNamespacesLive } from "./chat-bindings.ts";
import { ChatLive } from "./chat-http.ts";
import { ChatCapabilitiesLive } from "./chat-capability-http.ts";
import { BillingLive, BillingAdminLive } from "./billing-http.ts";
import { CurrentUser } from "./model.ts";

const PublicLive = HttpApiBuilder.group(Api, "public", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ ok: true })),
);

const PrivateLive = HttpApiBuilder.group(Api, "private", (handlers) =>
  handlers.handle("me", () => CurrentUser),
);

export const HttpLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(
    Layer.mergeAll(
      PublicLive,
      PrivateLive,
      AdminLive,
      ChatLive,
      ChatCapabilitiesLive,
      AccountLive,
      BillingLive,
      BillingAdminLive,
    ),
  ),
  Layer.provide(
    Layer.mergeAll(
      Authentication.layer,
      AdminAuthentication.layer,
      ChatAuthentication.layer,
      ChatNamespacesLive,
    ),
  ),
  Layer.provide(Http.Platform),
);
