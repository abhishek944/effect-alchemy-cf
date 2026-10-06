import { Auth } from "@starter/auth";
import { AuthLive } from "@starter/auth/cloudflare";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Http from "alchemy/Http";
import { Config, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { serveAssets } from "./assets.ts";
import { HttpLive } from "./http.ts";
import { workerOptions } from "./options.ts";
import { observeRequest, TelemetryLive } from "./observability.ts";

export default class ApiWorker extends Cloudflare.Worker<ApiWorker>()(
  "Api",
  workerOptions,
  Effect.gen(function* () {
    const auth = yield* Auth;
    const http = yield* HttpRouter.toHttpEffect(HttpLive);
    return {
      fetch: observeRequest(
        Http.safeHttpEffect(
          Effect.gen(function* () {
            const accessRequired = yield* Config.Boolean("REQUIRE_ACCESS").pipe(Effect.orDie);
            if (accessRequired && (yield* Cloudflare.Access.Context) === undefined) {
              return HttpServerResponse.text("Cloudflare Access required", { status: 403 });
            }
            const request = yield* HttpServerRequest;
            const pathname = request.url.split("?")[0] ?? "";
            if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
              return yield* auth.fetch.pipe(Effect.withSpan("auth.handle"));
            }
            if (!pathname.startsWith("/api/")) return yield* serveAssets;
            return yield* http.pipe(Effect.withSpan("api.handle"));
          }),
        ),
      ),
    };
  }).pipe(Effect.provide(Layer.mergeAll(AuthLive, TelemetryLive))),
) {}
