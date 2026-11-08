import { NodeFileSystem, NodeHttpPlatform } from "@effect/platform-node";
import { Cause, Effect, ErrorReporter, Layer } from "effect";
import type { FileSystem } from "effect";
import * as Etag from "effect/http/Etag";
import type { HttpBodyError } from "effect/http/HttpBody";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import { causeResponse, type HttpServerError } from "effect/http/HttpServerError";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Path from "effect/Path";
import type { Scope } from "effect/Scope";

/** The services `HttpApiBuilder.layer` needs, served from the Node runtime. */
export const httpPlatformLayer: Layer.Layer<
  HttpPlatform.HttpPlatform | Etag.Generator | Path.Path | FileSystem.FileSystem
> = Layer.mergeAll(NodeHttpPlatform.layer, Etag.layer, Path.layer, NodeFileSystem.layer);

export type HttpEffect<Req = never> = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  HttpServerError | HttpBodyError,
  HttpServerRequest | Scope | Req
>;

/** No ErrorReporter is registered unless telemetry installs one; keep a trace either way. */
const logUnreportedCause = (cause: Cause.Cause<unknown>) => {
  const failures = cause.reasons.filter(
    (reason) =>
      reason._tag !== "Interrupt" &&
      !ErrorReporter.isIgnored(reason._tag === "Fail" ? reason.error : reason.defect),
  );
  // oxlint-disable-next-line eslint/no-underscore-dangle -- Effect's own discriminant
  return failures.length === 0
    ? Effect.void
    : Effect.logError("HTTP handler failed", Cause.fromReasons(failures));
};

/**
 * The single response boundary: respondable failures keep their intended
 * response, client aborts map to 499 and everything else becomes an empty 500.
 * The cause is never echoed to the network and is reported once.
 */
export const safeHttpEffect = <Req = never>(
  handler: HttpEffect<Req>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Req | HttpServerRequest | Scope> =>
  Effect.catchCause(handler, (cause) =>
    causeResponse(cause).pipe(
      Effect.flatMap(([response, reportableCause]) =>
        Effect.withFiber((fiber) =>
          fiber.getRef(ErrorReporter.CurrentErrorReporters).size > 0
            ? ErrorReporter.report(reportableCause)
            : logUnreportedCause(reportableCause),
        ).pipe(Effect.as(response)),
      ),
    ),
  );
