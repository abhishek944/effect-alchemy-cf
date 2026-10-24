import type { WorkerEnvironment } from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy";
import { Effect, Option, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { CurrentOfficeSession } from "./office-authentication.ts";
import { artifact, channel, download, protocol, upload } from "./office-http-binary.ts";
import { officeCore } from "./office-http-call.ts";
import { officeOriginalSource, officeSources } from "./office-http-sources.ts";
import { OfficeOriginalRequest } from "@starter/office-contract";
import { stageOfficeOriginal } from "./office-http-original-stage.ts";
import type { OfficeDispatch } from "./office-http-call.ts";
import { officeProtocolPath } from "./office-http-channel.ts";
import { invalid, officeInvalid, officeReadJson } from "./office-http-model.ts";
import {
  officeArtifactPath,
  officeBytesPath,
  officeRead,
  officeUnsupportedCursor,
  officeUploadPath,
  officeWrite,
} from "./office-http-route.ts";

const decodePayload = (schema: Schema.ConstraintDecoder<unknown>, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(invalid),
  );
const readRoute = (dispatch: OfficeDispatch, pathname: string, query: URLSearchParams) => {
  // The private events contract paginates by `after` only; never silently ignore a cursor.
  if (officeUnsupportedCursor("GET", pathname, query)) return Effect.succeed(officeInvalid());
  const route = officeRead("GET", pathname, query);
  return route === null ? null : officeCore(dispatch, route.key, route.input);
};
const writeRoute = (dispatch: OfficeDispatch, request: Request, pathname: string) => {
  const route = officeWrite(request.method, pathname);
  if (route === null) return null;
  return Effect.gen(function* () {
    if (route.payload === null)
      return yield* officeCore(dispatch, route.key, route.input(undefined));
    const decoded = yield* decodePayload(route.payload, yield* officeReadJson(request.body));
    return yield* officeCore(dispatch, route.key, route.input(decoded));
  }).pipe(Effect.catch(() => Effect.succeed(officeInvalid())));
};

/** One authenticated public Office request. Paths are never rewritten for the native SDK. */
export const dispatchOffice = (
  dispatch: OfficeDispatch,
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  CurrentOfficeSession | RuntimeContext | WorkerEnvironment
> =>
  Effect.gen(function* () {
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
    const url = new URL(web.url);
    const pathname = url.pathname;
    if (officeProtocolPath(web.method, pathname, url.searchParams) !== null)
      return yield* protocol(dispatch, web, pathname, url.searchParams);
    if (web.method === "PUT" && officeUploadPath(pathname) !== null)
      return yield* upload(dispatch, web, pathname);
    if (web.method === "GET" && officeBytesPath(pathname) !== null)
      return yield* download(dispatch, pathname);
    if (web.method === "GET" && officeArtifactPath(pathname) !== null)
      return yield* artifact(dispatch, pathname);
    if (web.method === "POST" && pathname === "/api/office/channels")
      return yield* channel(dispatch, web.body);
    const staging = /^\/api\/office\/originals\/([A-Za-z0-9_-]{16,96})\/stage$/.exec(pathname);
    if (web.method === "POST" && staging?.[1] !== undefined) {
      const raw = yield* officeReadJson(web.body, 4096).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const parsed = Schema.decodeUnknownOption(OfficeOriginalRequest, {
        onExcessProperty: "error",
      })(typeof raw === "object" && raw !== null ? { ...raw, fileRef: staging[1] } : null);
      return Option.isSome(parsed)
        ? yield* stageOfficeOriginal(dispatch, parsed.value, web.signal)
        : officeInvalid();
    }
    const original = /^\/api\/office\/originals\/([A-Za-z0-9_-]{16,96})$/.exec(pathname);
    if (web.method === "GET" && original?.[1] !== undefined)
      return yield* officeOriginalSource(dispatch, original[1], url.searchParams);
    const sources = /^\/api\/office\/documents\/([A-Za-z0-9_-]{16,96})\/sources$/.exec(pathname);
    if (web.method === "GET" && sources?.[1] !== undefined)
      return yield* officeSources(dispatch, sources[1], url.searchParams);
    if (web.method === "GET")
      return yield* (
        readRoute(dispatch, pathname, url.searchParams) ?? Effect.succeed(officeInvalid())
      );
    if (web.method === "POST")
      return yield* writeRoute(dispatch, web, pathname) ?? Effect.succeed(officeInvalid());
    return officeInvalid();
  });
