import { Effect, type Schema } from "effect";
import {
  decodeWireSync,
  OfficeInvalid,
  OfficeLimited,
  OfficeUnavailable,
  safeFailure,
  type Failure,
  type OfficeError,
} from "@starter/office-contract";
import { hostEnvelope } from "@starter/office-server/native-remote";
import { officeChannelProfile, type OfficeControlOptions } from "./native-channel-profile.ts";
export type { OfficeControlOptions } from "./native-channel-profile.ts";
import { readOfficeControlBody } from "./native-channel-body.ts";
import { isOfficeChannelError, officeChannelError } from "./native-channel-errors.ts";

export type OfficeRemoteMethod<Q, A> = {
  readonly method: string;
  readonly request: Schema.ConstraintDecoder<{ readonly method: string; readonly input: Q }>;
  readonly response: Schema.ConstraintDecoder<
    | { readonly method: string; readonly value: A }
    | { readonly method: string; readonly error: Failure }
  >;
};
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Mandatory T47-bound private transport. Selectors and this factory do NOT authenticate a caller. */
function createPrivateJsonChannel(options: OfficeControlOptions, maximum: number) {
  const profile = officeChannelProfile(options);
  const { url, request, signal: parent } = profile;
  const stop = new AbortController();
  const pending = new Set<Promise<void>>();
  let closed = false,
    closePromise: Promise<void> | undefined,
    cleanupFailures = 0;
  let calls = 0,
    bytes = 0,
    active = 0;
  const cleanupFailed = () => {
    cleanupFailures++;
    closed = true;
    stop.abort();
  };
  const charge = (size: number) => {
    bytes += size;
    if (bytes > profile.maxBytes) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  };
  function call<Q, A>(
    definition: OfficeRemoteMethod<Q, A>,
    input: Q,
    mutation: boolean,
  ): Effect.Effect<A, OfficeError> {
    return Effect.suspend(() => {
      let sent = false;
      let peerFailure: OfficeError | undefined;
      return Effect.tryPromise({
        try: (effectSignal) => {
          const run = async () => {
            const remaining = profile.deadline - Date.now();
            if (closed || parent.aborted || effectSignal.aborted || remaining <= 0)
              throw unavailable();
            if (active >= profile.maxActive) throw new OfficeUnavailable(safeFailure("BUSY"));
            if (calls >= profile.maxCalls) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
            const callId = crypto.randomUUID();
            let body: string;
            try {
              body = JSON.stringify(
                decodeWireSync(hostEnvelope(definition.request))({
                  version: 1,
                  invocationId: profile.invocationId,
                  callId,
                  payload: { method: definition.method, input },
                }),
              );
            } catch {
              throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
            }
            const length = new TextEncoder().encode(body).byteLength;
            if (length > maximum) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
            charge(length);
            calls++;
            active++;
            const timeout = new AbortController();
            const timer = setTimeout(
              () => timeout.abort(),
              Math.min(Math.max(0, profile.deadline - Date.now()), 2147483647),
            );
            timer.unref();
            const signal = AbortSignal.any([parent, effectSignal, timeout.signal, stop.signal]);
            let response: Response | undefined;
            let result: A,
              cleanupError = false;
            try {
              signal.throwIfAborted();
              if (Date.now() >= profile.deadline) throw unavailable();
              sent = true;
              response = await request(
                new Request(url, {
                  method: "POST",
                  body,
                  signal,
                  redirect: "error",
                  credentials: "omit",
                  cache: "no-store",
                  headers: { "content-type": "application/json" },
                }),
              );
              if (!(response instanceof Response)) throw new Error("Invalid private response");
              signal.throwIfAborted();
              if (
                response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
                "application/json"
              )
                throw new Error("Invalid private control media type");
              const raw = await readOfficeControlBody(
                response,
                signal,
                profile.deadline,
                charge,
                cleanupFailed,
                maximum,
              );
              const value = decodeWireSync(hostEnvelope(definition.response))(
                JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
              );
              signal.throwIfAborted();
              if (
                Date.now() >= profile.deadline ||
                value.invocationId !== profile.invocationId ||
                value.callId !== callId ||
                value.payload.method !== definition.method
              )
                throw new Error("Private control association expired or changed");
              if ("error" in value.payload) {
                peerFailure = officeChannelError(value.payload.error);
                throw peerFailure;
              }
              if (response.status !== 200) throw new Error("Invalid private success status");
              result = value.payload.value;
            } finally {
              try {
                if (response?.body && !response.body.locked) await response.body.cancel();
              } catch {
                cleanupFailed();
                cleanupError = true;
              } finally {
                clearTimeout(timer);
                active--;
              }
            }
            if (cleanupError) throw unavailable();
            return result;
          };
          // Track before the task starts: Effect interruption alone does not join foreign IO.
          const actual = Promise.resolve().then(run);
          const observed = actual.then(
            () => undefined,
            () => undefined,
          );
          pending.add(observed);
          void observed.then(() => pending.delete(observed));
          return actual;
        },
        catch: (cause) => {
          if (peerFailure !== undefined) return peerFailure;
          if (sent && mutation) return new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
          return isOfficeChannelError(cause) ? officeChannelError(cause) : unavailable();
        },
      });
    });
  }
  function drain(): Promise<void> {
    return Promise.all(pending).then(() => {
      if (cleanupFailures > 0) throw unavailable();
      return undefined;
    });
  }
  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    stop.abort();
    closePromise = drain();
    return closePromise;
  }
  return Object.freeze({ call, drain, close });
}
export const createOfficeControlChannel = (options: OfficeControlOptions) =>
  createPrivateJsonChannel(options, 16 * 1024);
export const createOfficeManifestChannel = (options: OfficeControlOptions) =>
  createPrivateJsonChannel(options, 2 * 1024 * 1024);
export type OfficeControlChannel = ReturnType<typeof createOfficeControlChannel>;
export type OfficeControlCaller = Pick<OfficeControlChannel, "call">;
export type OfficeControlSession = Pick<OfficeControlChannel, "call" | "drain">;
