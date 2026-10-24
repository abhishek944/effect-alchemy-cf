import type { WorkerEnvironment } from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy";
import { Effect } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { safeFailure } from "@starter/office-contract";
import { CurrentOfficeSession } from "./office-authentication.ts";
import { officeHostFetch, officeHostRequest, officeInvocation } from "./office-http-call.ts";
import type { OfficeDispatch } from "./office-http-call.ts";
import {
  officeFailure,
  officeInvalid,
  officeJson,
  officeJsonValue,
  officeReadBytes,
  officeReadJson,
} from "./office-http-model.ts";
import {
  officeChannelReply,
  officeChannelRequest,
  officeProtocolPath,
} from "./office-http-channel.ts";
import { officeArtifactPath, officeBytesPath, officeUploadPath } from "./office-http-route.ts";
import { officeArtifact, officeUploadMetadata, officeUploadReply } from "./office-http-upload.ts";

type OfficeResponse = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  CurrentOfficeSession | RuntimeContext | WorkerEnvironment
>;
const smallReply = 64 * 1024;
const gone = () => officeFailure(safeFailure("UNAVAILABLE"));

/** Public PUT upload: opaque streamed bytes plus fixed metadata; ACK must match the source. */
export const upload = (
  dispatch: OfficeDispatch,
  request: Request,
  pathname: string,
): OfficeResponse =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const operationId = officeUploadPath(pathname);
    if (operationId === null) return officeInvalid();
    const metadata = officeUploadMetadata(request, operationId);
    if (!metadata.ok)
      return metadata.limited
        ? officeFailure({
            code: "LIMIT_EXCEEDED",
            message: "Upload exceeds its byte limit.",
            retry: "never",
            operationId: null,
          })
        : officeInvalid();
    const invocationId = yield* officeInvocation(dispatch);
    const response = yield* officeHostFetch(dispatch, session, `/upload/${invocationId}`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-office-upload": JSON.stringify(metadata.upload),
      },
      body: request.body,
    });
    if (response.status !== 200) return gone();
    const value = officeJsonValue(yield* officeReadBytes(response, smallReply));
    const ref = officeUploadReply(metadata.upload, value);
    return ref === null ? gone() : officeJson(ref);
  }).pipe(Effect.catch(() => Effect.succeed(gone())));

/** Public artifact metadata: finite private metadata route, never download aggregation. */
export const artifact = (dispatch: OfficeDispatch, pathname: string): OfficeResponse =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const artifactId = officeArtifactPath(pathname);
    if (artifactId === null) return officeInvalid();
    const invocationId = yield* officeInvocation(dispatch);
    const response = yield* officeHostFetch(
      dispatch,
      session,
      `/artifact/${invocationId}/${artifactId}`,
      { method: "POST", headers: { accept: "application/json" } },
    );
    if (response.status !== 200) return gone();
    const ref = officeArtifact(officeJsonValue(yield* officeReadBytes(response, smallReply)));
    return ref === null || ref.id !== artifactId ? gone() : officeJson(ref);
  }).pipe(Effect.catch(() => Effect.succeed(gone())));

/** Public GET download dispatches the agreed PRIVATE POST and transfers opaque bytes. */
export const download = (dispatch: OfficeDispatch, pathname: string): OfficeResponse =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const artifactId = officeBytesPath(pathname);
    if (artifactId === null) return officeInvalid();
    const invocationId = yield* officeInvocation(dispatch);
    const response = yield* officeHostFetch(
      dispatch,
      session,
      `/download/${invocationId}/${artifactId}`,
      { method: "POST", headers: { accept: "application/octet-stream" } },
    );
    if (response.status !== 200) return gone();
    // Opaque streamed bytes: the private response body is transferred, never buffered.
    return HttpServerResponse.setHeader(
      HttpServerResponse.raw(response),
      "cache-control",
      "private, no-store",
    );
  }).pipe(Effect.catch(() => Effect.succeed(gone())));

/** Public channel creation for one real View/editor; reply is the canonical channel only. */
export const channel = (
  dispatch: OfficeDispatch,
  body: ReadableStream<Uint8Array> | null,
): OfficeResponse =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const input = officeChannelRequest(yield* officeReadJson(body, 4096));
    if (input === null) return officeInvalid();
    const invocationId = yield* officeInvocation(dispatch, "channel");
    const response = yield* officeHostFetch(dispatch, session, `/channel/${invocationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.status !== 200) return gone();
    const reply = officeChannelReply(officeJsonValue(yield* officeReadBytes(response, 4096)));
    if (reply === null || reply.expiresAt <= Date.now()) return gone();
    return officeJson(reply);
  }).pipe(Effect.catch(() => Effect.succeed(gone())));

/** Native SDK forwarding with a NEW registrar invocation; 101 keeps the genuine Response. */
export const protocol = (
  dispatch: OfficeDispatch,
  request: Request,
  pathname: string,
  query: URLSearchParams,
): OfficeResponse =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const forward = officeProtocolPath(request.method, pathname, query);
    if (forward === null) return officeInvalid();
    const invocationId = yield* officeInvocation(dispatch);
    const target =
      `http://office-api.internal/protocol/${invocationId}/${forward.channelId}` +
      `${forward.nativePath}${forward.query}`;
    // Same method, native path and streamed body; native bytes stay opaque to this layer.
    const response = yield* officeHostRequest(dispatch, session, new Request(target, request));
    return HttpServerResponse.raw(response);
  }).pipe(Effect.catch(() => Effect.succeed(gone())));
