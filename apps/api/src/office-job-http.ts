import { Effect, Schema, Stream } from "effect";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { readOfficePrivateJson } from "./office-private-json.ts";
import type { OfficeJobRole } from "./office-job-object.ts";

const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const unavailable = (cause: unknown) =>
  withCause(
    withDiagnostic(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")), "job-http-output"),
    cause,
  );
const endpoint = "http://office-job.internal";
const Status = Schema.Struct({ cancel: Schema.Boolean });

/** Fresh job-role HTTP surface. Exactly POST /run and POST /status on the fixed internal audience;
 * no actor registration, forwarding, retry or alternative route. The opaque OJOB body is consumed by
 * the role itself, and the exit JSON is bounded metadata only.
 *
 * The /run lifetime is the ENCLOSING per-call Scope: the caller must convert this HttpServerResponse
 * with `HttpEffect.scopeTransferToStream` (as Alchemy's HttpServer does) so the Scope closes when the
 * body stream exits. Closing it after headers would tear the fresh box down before its output is sent.
 */
export const officeJobHttp = (role: OfficeJobRole, request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    if (
      url.origin !== endpoint ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      request.method !== "POST"
    )
      return yield* Effect.fail(denied());
    if (url.pathname === "/run") {
      const body = request.body;
      if (body === null) return yield* Effect.fail(denied());
      // Registered BEFORE run so a partial start is still torn down if the role fails.
      yield* Effect.addFinalizer(() => Effect.promise(() => role.close()));
      const output = yield* Effect.onError(role.runJob(body), () =>
        Effect.promise(() => body.cancel().catch(() => undefined)),
      );
      return HttpServerResponse.stream(
        Stream.fromReadableStream({ evaluate: () => output, onError: unavailable }),
        {
          contentType: "application/octet-stream",
          headers: { "cache-control": "private, no-store" },
        },
      );
    }
    if (url.pathname !== "/status") return yield* Effect.fail(denied());
    const payload = yield* Effect.tryPromise({
      try: () =>
        readOfficePrivateJson(request.body, request.signal, Date.now() + 10_000, 16 * 1024),
      catch: (cause) => withCause(withDiagnostic(denied(), "job-status-body"), cause),
    });
    const input = yield* Effect.try({
      try: () => decodeWireSync(Status)(payload),
      catch: (cause) => withCause(withDiagnostic(denied(), "job-status-schema"), cause),
    });
    const exit = yield* role.jobStatus(input.cancel);
    return HttpServerResponse.uint8Array(new TextEncoder().encode(JSON.stringify(exit)), {
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
    });
  });
