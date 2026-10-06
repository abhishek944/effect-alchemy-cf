import * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyTelemetry from "alchemy/Telemetry";
import { Cause, Config, Effect, Exit, Layer, Logger } from "effect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

// Keep framework diagnostics useful without exporting messages, causes or annotations.
const diagnosticLogger = Logger.withConsoleLog(
  Logger.make(({ date, logLevel }) => ({
    timestamp: date.toISOString(),
    level: logLevel.toUpperCase(),
    event: "application.log",
  })),
);

export const TelemetryLive = Layer.mergeAll(
  Cloudflare.Telemetry(),
  AlchemyTelemetry.layer(
    Layer.mergeAll(
      Logger.layer([diagnosticLogger]),
      // Effect HTTP's automatic tracer captures raw URLs/headers. Use native
      // platform tracing (query-redacted) plus our fixed-name application spans.
      Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true),
    ),
  ),
);

const routeCategory = (url: string) => {
  const path = url.split("?")[0];
  if (path === "/api/health" || path === "/api/me") return path;
  if (path === "/api/auth" || path?.startsWith("/api/auth/")) return "/api/auth/*";
  return path?.startsWith("/api/") ? "/api/*" : "assets";
};

export const observeRequest = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const metadata = yield* Config.all({
      service: Config.String("OBS_SERVICE"),
      stage: Config.String("OBS_STAGE"),
      release: Config.String("OBS_RELEASE"),
    }).pipe(Effect.orDie);
    const requestId = crypto.randomUUID();
    const started = performance.now();
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      request.method,
    )
      ? request.method
      : "OTHER";
    const route = routeCategory(request.url);
    return yield* handler.pipe(
      Effect.map((response) => HttpServerResponse.setHeader(response, "x-request-id", requestId)),
      Effect.onExit((exit) => {
        const status = Exit.isSuccess(exit)
          ? exit.value.status
          : Cause.hasInterruptsOnly(exit.cause)
            ? 499
            : 500;
        const formatter = Logger.make(({ date, logLevel }) => ({
          timestamp: date.toISOString(),
          level: logLevel.toUpperCase(),
          event: "request.complete",
          ...metadata,
          request_id: requestId,
          method,
          route,
          status,
          outcome: Exit.isSuccess(exit) ? "response" : "failure",
          duration_ms: Math.round((performance.now() - started) * 100) / 100,
        }));
        const logger =
          status >= 500 ? Logger.withConsoleError(formatter) : Logger.withConsoleLog(formatter);
        return (
          status >= 500 ? Effect.logError("request.complete") : Effect.log("request.complete")
        ).pipe(Effect.provide(Logger.layer([logger])));
      }),
      Effect.withSpan("request.handle"),
    );
  });
