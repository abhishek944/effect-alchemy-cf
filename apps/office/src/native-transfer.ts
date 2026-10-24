import { Effect, Schema } from "effect";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import {
  Count,
  decodeWireSync,
  OfficeInvalid,
  OfficeLimited,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import { hostEnvelope } from "@starter/office-server/native-remote";
import { officeChannelProfile, type OfficeControlOptions } from "./native-channel-profile.ts";
import type { OfficeRemoteMethod } from "./native-channel.ts";
import type { OfficeBinaryChannel, OfficeBinaryInput } from "./native-transfer-types.ts";
import { OfficeBinaryResource } from "./native-transfer-resource.ts";
import { officeBinaryPrefix, readOfficeBinaryReply } from "./native-transfer-frame.ts";
import { officeBinaryUpload } from "./native-transfer-upload.ts";
import { officeBinaryResponse } from "./native-transfer-body.ts";
import { isOfficeChannelError, officeChannelError } from "./native-channel-errors.ts";

const Transfer = Schema.Struct({
  requestBytes: Count.check(Schema.isLessThanOrEqualTo(256 * 1024 * 1024)),
  responseLimit: Count.check(Schema.isLessThanOrEqualTo(256 * 1024 * 1024)),
  mutation: Schema.Boolean,
});
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Actual framed fetch transport. T47 must supply the real original private request binding. */
export function createOfficeBinaryChannel(options: OfficeControlOptions): OfficeBinaryChannel {
  const profile = officeChannelProfile(options);
  const resources = new Set<OfficeBinaryResource>();
  let calls = 0,
    bytes = 0,
    closed = false,
    failed = false,
    closing: Promise<void> | undefined;
  let failureCause: unknown;
  const fail = (cause: unknown) => {
    if (!failed) failureCause = cause;
    failed = true;
    closed = true;
    for (const resource of resources) resource.revoke();
  };
  const charge = (size: number) => {
    bytes += size;
    if (bytes > profile.maxBytes) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  };
  function exchange<Q, A>(
    definition: OfficeRemoteMethod<Q, A>,
    input: Q,
    transfer: OfficeBinaryInput,
  ): Effect.Effect<{ readonly value: A; readonly body: ReadableStream<Uint8Array> }, OfficeError> {
    return Effect.suspend(() => {
      let sent = false,
        peer: OfficeError | undefined;
      return Effect.tryPromise({
        try: (effectSignal) => {
          if (
            closed ||
            profile.signal.aborted ||
            effectSignal.aborted ||
            Date.now() >= profile.deadline
          )
            return Promise.reject(unavailable());
          if (resources.size >= profile.maxActive)
            return Promise.reject(new OfficeUnavailable(safeFailure("BUSY")));
          if (calls >= profile.maxCalls)
            return Promise.reject(new OfficeLimited(safeFailure("LIMIT_EXCEEDED")));
          const limits = decodeWireSync(Transfer)({
            requestBytes: transfer.requestBytes,
            responseLimit: transfer.responseLimit,
            mutation: transfer.mutation,
          });
          const callId = crypto.randomUUID();
          const header = decodeWireSync(hostEnvelope(definition.request))({
            version: 1,
            invocationId: profile.invocationId,
            callId,
            payload: { method: definition.method, input },
          });
          if (transfer.body === null && limits.requestBytes !== 0)
            return Promise.reject(new OfficeInvalid(safeFailure("INVALID_INPUT")));
          const prefix = officeBinaryPrefix(JSON.stringify(header));
          const resource = new OfficeBinaryResource(
            profile.signal,
            effectSignal,
            profile.deadline,
            fail,
          );
          resources.add(resource);
          void resource.done.then(() => resources.delete(resource));
          calls++;
          const begin = async () => {
            resource.check();
            const upload = officeBinaryUpload(
              prefix,
              transfer.body,
              limits.requestBytes,
              resource.signal,
              profile.deadline,
              charge,
            );
            resource.add(upload.cancel);
            const init: RequestInit & { readonly duplex: "half" } = {
              method: "POST",
              body: upload.stream,
              signal: resource.signal,
              duplex: "half",
              redirect: "error",
              credentials: "omit",
              cache: "no-store",
              headers: { "content-type": "application/octet-stream" },
            };
            resource.check();
            sent = true;
            const response = await profile.request(new Request(profile.url, init));
            const { reply, cursor } = await readOfficeBinaryReply(
              response,
              definition,
              resource,
              profile.invocationId,
              callId,
              charge,
            );
            if ("error" in reply.payload) {
              peer = officeChannelError(reply.payload.error);
              throw peer;
            }
            if (response.status !== 200) throw new Error("Invalid private binary success status");
            await upload.complete();
            resource.check();
            const empty = limits.responseLimit === 0 || reply.payload.value === null;
            if (empty) {
              const tail = await cursor.next();
              if (!tail.done) throw new Error("Unexpected private binary response bytes");
              return {
                value: reply.payload.value,
                body: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
                empty,
              };
            }
            return {
              value: reply.payload.value,
              body: officeBinaryResponse(cursor, resource, limits.responseLimit),
              empty,
            };
          };
          // Register and observe the REAL setup before it starts, including cancellation/partial construction.
          const actual = Promise.resolve().then(begin);
          resource.started(actual);
          return actual.then(
            async (result) => {
              if (result.empty) await resource.close();
              return { value: result.value, body: result.body };
            },
            async (cause: unknown) => {
              try {
                await resource.close();
              } catch {
                /* Actual cleanup failure remains recorded by fail(). */
              }
              throw cause;
            },
          );
        },
        catch: (cause) => {
          if (peer !== undefined) return peer;
          if (sent && transfer.mutation)
            return new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
          return isOfficeChannelError(cause) ? officeChannelError(cause) : unavailable();
        },
      });
    });
  }
  function drain(): Promise<void> {
    return Promise.all([...resources].map((resource) => resource.done)).then(() => {
      if (failed)
        throw withCause(withDiagnostic(unavailable(), "binary-channel-drain"), failureCause);
      return undefined;
    });
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closed = true;
    closing = Promise.allSettled([...resources].map((resource) => resource.close())).then(
      (results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (failed || rejected !== undefined)
          throw withCause(
            withDiagnostic(unavailable(), "binary-channel-close"),
            failed ? failureCause : rejected?.reason,
          );
        return undefined;
      },
    );
    return closing;
  }
  return Object.freeze({ exchange, drain, close });
}
