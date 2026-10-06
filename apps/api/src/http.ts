import * as Http from "alchemy/Http";
import { Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Api } from "./api.ts";
import { Authentication } from "./authentication.ts";
import { CurrentUser } from "./model.ts";

const PublicLive = HttpApiBuilder.group(Api, "public", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ ok: true })),
);

const PrivateLive = HttpApiBuilder.group(Api, "private", (handlers) =>
  handlers.handle("me", () => CurrentUser),
);

export const HttpLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Layer.mergeAll(PublicLive, PrivateLive)),
  Layer.provide(Authentication.layer),
  Layer.provide(Http.Platform),
);
