import { RuntimeContext } from "alchemy";
import { WorkerEnvironment } from "alchemy/Cloudflare";
import { Effect, Layer, Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import type * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { OfficeApi, OfficeForbidden, safeFailure } from "@starter/office-contract";
import { OfficeAuthentication } from "./office-authentication.ts";
import type { OfficeDispatch } from "./office-http-call.ts";
import { dispatchOffice } from "./office-http-dispatch.ts";
import { officeFailure } from "./office-http-model.ts";

/** Public Office surface. Native SDK paths (`/universer-api/...`) stay actual, never rewritten. */
export const isOfficePath = (pathname: string): boolean =>
  pathname === "/api/office" ||
  pathname.startsWith("/api/office/") ||
  pathname.startsWith("/universer-api/");
const gone = () => officeFailure(safeFailure("UNAVAILABLE"));

/** Real contract metadata (Top schemas) for the middleware call; never a fabricated endpoint. */
const Contract = (() => {
  let group: HttpApiGroup.Top | null = null;
  let endpoint: HttpApiEndpoint.Top | null = null;
  HttpApi.reflect(OfficeApi, {
    onGroup: ({ group: actual }) => {
      group ??= actual;
    },
    onEndpoint: ({ endpoint: actual }) => {
      endpoint ??= actual;
    },
  });
  if (group === null || endpoint === null) throw new Error("Office contract has no endpoint");
  return { group, endpoint };
})();
type Authenticate = Effect.Success<typeof OfficeAuthentication>;

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
    return yield* authenticate(run, Contract).pipe(
      Effect.catchTag("Unauthorized", () =>
        Effect.succeed(HttpServerResponse.empty({ status: 401 })),
      ),
      Effect.catchTag("AuthenticationUnavailable", () => Effect.succeed(gone())),
      Effect.catch((error) =>
        Effect.succeed(Schema.is(OfficeForbidden)(error) ? officeFailure(error) : gone()),
      ),
      Effect.catchDefect(() => Effect.succeed(gone())),
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
        const authenticate = yield* OfficeAuthentication;
        const handler = officeRoute(dispatch)(authenticate);
        yield* router.add("*", "/api/office/*", handler);
        yield* router.add("*", "/universer-api/*", handler);
      }),
    ).pipe(Layer.provide(OfficeAuthentication.layer)),
  );
