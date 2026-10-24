import { RuntimeContext } from "alchemy";
import { WorkerEnvironment } from "alchemy/Cloudflare";
import { Cause, Effect, Layer, Schema } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { OfficeAuthentication } from "./office-authentication.ts";
import type { OfficeDispatch } from "./office-http-call.ts";
import { dispatchOffice } from "./office-http-dispatch.ts";
import { officeFailure } from "./office-http-model.ts";
import { Unauthorized } from "./model.ts";
import { reportOfficeHttpFailure } from "./office-http-failure.ts";

/** Public Office surface. Native SDK paths (`/universer-api/...`) stay actual, never rewritten. */
export const isOfficePath = (pathname: string): boolean =>
  pathname === "/api/office" ||
  pathname.startsWith("/api/office/") ||
  pathname.startsWith("/universer-api/");
const gone = () => officeFailure(safeFailure("UNAVAILABLE"));

type Authenticate = Effect.Success<typeof OfficeAuthentication>["authenticate"];

/** Real OfficeAuthentication before any owner namespace selection; never input Actor JSON. */
const officeRoute = (dispatch: OfficeDispatch) => (authenticate: Authenticate) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const runtime = yield* RuntimeContext;
    // Both real runtime services are already in this request context; pin them so the
    // middleware input requires only the session it actually provides.
    const environment = yield* WorkerEnvironment;
    const run = dispatchOffice(dispatch, request).pipe(
      Effect.provideService(RuntimeContext, runtime),
      Effect.provideService(WorkerEnvironment, environment),
    );
    return yield* authenticate(run).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause))
          return Effect.failCause(
            Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
          );
        const reason = cause.reasons[0];
        const error =
          cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)
            ? reason.error
            : undefined;
        if (error instanceof Unauthorized)
          return Effect.succeed(HttpServerResponse.empty({ status: 401 }));
        const response = Schema.is(OfficeForbidden)(error) ? officeFailure(error) : gone();
        return reportOfficeHttpFailure(cause, "route").pipe(Effect.as(response));
      }),
    );
  });

/**
 * Minimal real router for the Office surface. Routes are wildcards because native SDK paths are
 * open-ended; each handler keeps the actual request path for the private dispatch. No second
 * server, no second application and no optional namespace.
 */
export const makeOfficeHttp = (dispatch: OfficeDispatch) =>
  HttpRouter.toHttpEffect(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const { authenticate } = yield* OfficeAuthentication;
        const handler = officeRoute(dispatch)(authenticate);
        yield* router.add("*", "/api/office/*", handler);
        yield* router.add("*", "/universer-api/*", handler);
      }),
    ).pipe(Layer.provide(OfficeAuthentication.layer)),
  );
