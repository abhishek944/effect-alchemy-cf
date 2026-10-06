import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

const AssetFetcher = Schema.declare<AssetFetcher>(
  (value): value is AssetFetcher =>
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof value.fetch === "function",
);

export const serveAssets = Effect.gen(function* () {
  const environment = yield* Cloudflare.WorkerEnvironment;
  const assets = yield* Schema.decodeUnknownEffect(AssetFetcher)(environment.ASSETS).pipe(
    Effect.orDie,
  );
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const response = yield* Effect.promise(() => assets.fetch(webRequest));
  return HttpServerResponse.fromWeb(response);
});
