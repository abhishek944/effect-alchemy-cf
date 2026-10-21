import type { WorkerEnvironment } from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy";
import { Effect, Option, Schema } from "effect";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import { decodeWireSync, safeFailure } from "@starter/office-contract";
import type { OfficeError } from "@starter/office-contract";
import { HostOffice, HostOfficeRequest, hostEnvelope } from "@starter/office-server/native-remote";
import { CurrentOfficeSession } from "./office-authentication.ts";
import { officeHostName } from "./office-host-object.ts";
import { officeNativeRequest, officeWebResponse } from "./office-platform.ts";
import type { makeOfficeHumanRegistrar } from "./office-host-object.ts";
import type { OfficeNamespace } from "./office-private-bindings.ts";
import {
  OFFICE_HTTP_METADATA_BYTES,
  invalid,
  officeFailure,
  officeJson,
  readBounded,
  unavailable,
} from "./office-http-model.ts";

/**
 * Actual private same-script binding plus the genuine session registrar; never input JSON.
 * The namespace is an EFFECT, so the raw platform binding is resolved inside the authenticated
 * request event only, never in the ApiWorker constructor/build scope (real-event contract).
 */
export type OfficeDispatch = {
  readonly registry: Effect.Success<typeof makeOfficeHumanRegistrar>;
  readonly namespace: Effect.Effect<OfficeNamespace, OfficeError, WorkerEnvironment>;
};
/** Agreed private human API audience. The namespace is the only route to its OfficeHost. */
const host = "http://office-api.internal";
const replyBytes = 2 * OFFICE_HTTP_METADATA_BYTES;
const ReplyPayload = Schema.Union(Object.values(HostOffice).map((method) => method.response));
const Reply = hostEnvelope(ReplyPayload);

/** Raw native fetch against the private namespace; no Alchemy RPC retry for any dispatch. */
export const officeHostFetch = (
  dispatch: OfficeDispatch,
  owner: { readonly stage: string; readonly ownerId: string },
  path: string,
  init: RequestInit,
): Effect.Effect<Response, OfficeError, WorkerEnvironment> =>
  Effect.gen(function* () {
    const namespace = yield* dispatch.namespace;
    return yield* Effect.tryPromise({
      try: async () => {
        const native = officeNativeRequest(new Request(`${host}${path}`, init));
        const response: unknown = await namespace
          .getByName(officeHostName({ stage: owner.stage, ownerId: owner.ownerId }))
          .fetch(native);
        return officeWebResponse(response);
      },
      catch: unavailable,
    });
  });

/** Raw native fetch of an already-built private request (preserves WebSocket upgrade intent). */
export const officeHostRequest = (
  dispatch: OfficeDispatch,
  owner: { readonly stage: string; readonly ownerId: string },
  request: Request,
): Effect.Effect<Response, OfficeError, WorkerEnvironment> =>
  Effect.gen(function* () {
    const namespace = yield* dispatch.namespace;
    return yield* Effect.tryPromise({
      try: async () => {
        const response: unknown = await namespace
          .getByName(officeHostName({ stage: owner.stage, ownerId: owner.ownerId }))
          .fetch(officeNativeRequest(request));
        return officeWebResponse(response);
      },
      catch: unavailable,
    });
  });

/** One NEW real registrar invocation for this incoming request; released by the private root. */
export const officeInvocation = (dispatch: OfficeDispatch) =>
  Effect.map(dispatch.registry, ({ invocationId }) => invocationId);

/** Public command -> real HostOfficeRequest JSON after strict private-contract validation. */
export const officeCommand = (key: keyof typeof HostOffice, input: unknown) =>
  Effect.try({
    try: () => {
      const command = decodeWireSync(HostOfficeRequest)({ method: HostOffice[key].method, input });
      const text = JSON.stringify(command);
      if (new TextEncoder().encode(text).byteLength > OFFICE_HTTP_METADATA_BYTES) throw invalid();
      return { command, text };
    },
    catch: invalid,
  });

/** Unwrap the real command reply; the private envelope itself is never shown to a browser. */
export const officeCommandResponse = (
  key: keyof typeof HostOffice,
  invocationId: string,
  bytes: Uint8Array,
): HttpServerResponse.HttpServerResponse => {
  const method = HostOffice[key].method;
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    const envelope = Option.getOrNull(
      Schema.decodeUnknownOption(Reply, { onExcessProperty: "error" })(value),
    );
    const payload =
      envelope !== null && envelope.invocationId === invocationId
        ? envelope.payload
        : Option.getOrNull(
            Schema.decodeUnknownOption(ReplyPayload, { onExcessProperty: "error" })(value),
          );
    if (payload === null || payload.method !== method)
      return officeFailure(safeFailure("UNAVAILABLE"));
    return "error" in payload ? officeFailure(payload.error) : officeJson(payload.value);
  } catch {
    return officeFailure(safeFailure("UNAVAILABLE"));
  }
};

/** One authenticated public command: register, dispatch raw, unwrap, raise typed error. */
export const officeCore = (
  dispatch: OfficeDispatch,
  key: keyof typeof HostOffice,
  input: unknown,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  CurrentOfficeSession | RuntimeContext | WorkerEnvironment
> =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const encoded = yield* officeCommand(key, input);
    const invocationId = yield* officeInvocation(dispatch);
    const response = yield* officeHostFetch(dispatch, session, `/core/${invocationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encoded.text,
    });
    if (response.status !== 200) return officeFailure(safeFailure("UNAVAILABLE"));
    const bytes = yield* readBounded(response, replyBytes);
    return officeCommandResponse(key, invocationId, bytes);
  }).pipe(Effect.catch((error: OfficeError) => Effect.succeed(officeFailure(error))));
