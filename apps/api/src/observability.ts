import * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyTelemetry from "alchemy/Telemetry";
import { failureRecord, reportFailure, type FailureContext } from "@starter/diagnostics";
import {
  Cause,
  Config,
  Effect,
  ErrorReporter,
  Exit,
  Layer,
  Logger,
  References,
  type Fiber,
} from "effect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { expectedPublicRejection } from "./diagnostic-policy.ts";
import { requestRoute } from "./request-route.ts";

const requestContext = (fiber: Fiber.Fiber<unknown, unknown>): FailureContext => {
  const annotations = fiber.getRef(References.CurrentLogAnnotations);
  const text = (key: string) =>
    typeof annotations[key] === "string" ? annotations[key] : undefined;
  return {
    component: "api",
    operation: "http.request",
    requestId: text("diagnostic.request_id"),
    service: text("diagnostic.service"),
    stage: text("diagnostic.stage"),
    release: text("diagnostic.release"),
    route: text("diagnostic.route"),
  };
};

// Project the original Cause, not arbitrary log messages or pretty-printed errors.
const diagnosticLogger = Logger.make(({ date, logLevel, cause, fiber }) => {
  const line = JSON.stringify({
    ...failureRecord(cause, requestContext(fiber)),
    timestamp: date.toISOString(),
    level: logLevel.toUpperCase(),
    event: cause.reasons.length === 0 ? "application.log" : "application.failure",
  });
  if (logLevel === "Error" || logLevel === "Fatal") console.error(line);
  else console.log(line);
});

const diagnosticReporter = Effect.sync(() => {
  const reported = new WeakSet<object>();
  return ErrorReporter.make(({ cause, fiber }) => {
    // make calls back per error; one record retains the complete reportable Cause.
    if (reported.has(cause)) return;
    const reasons = cause.reasons.filter(
      (reason) =>
        !Cause.isInterruptReason(reason) &&
        !(Cause.isFailReason(reason) && expectedPublicRejection(reason.error)) &&
        !ErrorReporter.isIgnored(Cause.isFailReason(reason) ? reason.error : reason.defect),
    );
    if (reasons.length === 0) return;
    reported.add(cause);
    reportFailure(Cause.fromReasons(reasons), requestContext(fiber));
  });
});

export const TelemetryLive = Layer.mergeAll(
  Cloudflare.Telemetry(),
  AlchemyTelemetry.layer(
    Layer.mergeAll(
      Logger.layer([diagnosticLogger]),
      // Alchemy's safeHttpEffect already reports before its public response encoding.
      ErrorReporter.layer([diagnosticReporter]),
      // Effect HTTP's automatic tracer captures raw URLs/headers. Use native
      // platform tracing (query-redacted) plus our fixed-name application spans.
      Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true),
    ),
  ),
);

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
    const route = requestRoute(request.url);
    return yield* handler.pipe(
      Effect.map((response) => HttpServerResponse.setHeader(response, "x-request-id", requestId)),
      Effect.onExit((exit) => {
        const status = Exit.isSuccess(exit)
          ? exit.value.status
          : Cause.hasInterruptsOnly(exit.cause)
            ? 499
            : 500;
        const logger = Logger.make(({ date, logLevel }) => {
          const line = JSON.stringify({
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
          });
          if (status >= 500) console.error(line);
          else console.log(line);
        });
        return (
          status >= 500 ? Effect.logError("request.complete") : Effect.log("request.complete")
        ).pipe(Effect.provide(Logger.layer([logger])));
      }),
      Effect.withSpan("request.handle"),
      Effect.annotateLogs({
        "diagnostic.request_id": requestId,
        "diagnostic.service": metadata.service,
        "diagnostic.stage": metadata.stage,
        "diagnostic.release": metadata.release,
        "diagnostic.route": route,
      }),
    );
  });
