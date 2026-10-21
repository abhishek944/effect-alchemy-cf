import { Effect } from "effect";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import {
  HostNativeAccess,
  HostNativeHandles,
  HostPolicy,
} from "@starter/office-server/native-remote";
import type { NativeAccess, NativeTarget, OfficeDependencies } from "@starter/office-server/ports";
import type { OfficeControlSession, OfficeRemoteMethod } from "./native-channel.ts";
import type { OfficeBinarySession, OfficeBinaryInput } from "./native-transfer-types.ts";
import { createNativeCoreAdapter } from "./native-core-adapter.ts";
import { createNativeDraftAdapter } from "./native-draft-adapter.ts";
import { NativeValues } from "./native-values.ts";
import { createNativeBytesClient } from "./native-bytes-client.ts";
import { adapterFailure } from "./native-stream-io.ts";

export function runNative<A>(
  effect: Effect.Effect<A, OfficeError>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(
    Effect.match(effect, {
      onSuccess: (value): { value: A } => ({ value }),
      onFailure: (error): { error: OfficeError } => ({ error }),
    }),
    { signal },
  ).then((result) => {
    if ("error" in result) throw result.error;
    return result.value;
  });
}
export type NativeSession = {
  readonly access: NativeAccess;
  readonly target: NativeTarget;
  readonly policy: OfficeDependencies["policy"];
  readonly handleId: string;
  readonly worktreeId: string | null;
  readonly baselineRevision: number | null;
  readonly readers: Set<{ cancel(reason: unknown): Promise<void> }>;
  check(userID?: string, unitID?: string, worktreeID?: string): void;
  write(): void;
  call<Q, A>(method: OfficeRemoteMethod<Q, A>, input: Q, mutation: boolean): Promise<A>;
  exchange<Q, A>(
    method: OfficeRemoteMethod<Q, A>,
    input: Q,
    transfer: OfficeBinaryInput,
  ): Promise<{ value: A; body: ReadableStream<Uint8Array> }>;
  task<A>(body: () => Promise<A>): Promise<A>;
  own<Args extends readonly unknown[], A>(
    body: (...args: Args) => Promise<A>,
  ): (...args: Args) => Promise<A>;
  close(): Promise<void>;
};
/** Original handle/turn only. Borrowed request dispatchers remain owned by17/T47. */
export function createNativeClient(options: {
  readonly manifest: OfficeControlSession;
  readonly cleanup: OfficeControlSession;
  readonly binary: OfficeBinarySession;
  readonly policy: OfficeDependencies["policy"];
}): Pick<OfficeDependencies, "native" | "bytes"> {
  const { manifest, cleanup, binary } = options;
  const policy = decodeWireSync(HostPolicy)(structuredClone(options.policy));
  const native: OfficeDependencies["native"] = (input) =>
    Effect.gen(function* () {
      const access = yield* Effect.try({
        try: () => decodeWireSync(HostNativeAccess)(structuredClone(input)),
        catch: adapterFailure,
      });
      const target = access.kind === "read" ? access.target : access.permit.target;
      const stop = new AbortController(),
        readers: NativeSession["readers"] = new Set();
      const pending = new Set<Promise<unknown>>();
      let active = true,
        closePromise: Promise<void> | undefined;
      const opened = yield* Effect.acquireRelease(
        manifest.call(HostNativeHandles.open, { access }, true),
        (grant) => Effect.promise(() => close(grant.handleId)),
      );
      function check(userID?: string, unitID?: string, worktreeID?: string): void {
        for (const id of [userID, unitID, worktreeID])
          if (
            id !== undefined &&
            (id.length < 1 || id.length > 256 || new TextEncoder().encode(id).byteLength > 256)
          )
            throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        if (!active || stop.signal.aborted || Date.now() >= opened.deadline)
          throw new OfficeUnavailable(safeFailure("AUTHORITY_LOST"));
        if (
          (userID !== undefined && userID !== target.owner.ownerId) ||
          (unitID !== undefined && unitID !== target.unitId) ||
          (worktreeID !== undefined && worktreeID !== opened.worktreeId)
        )
          throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      }
      function task<A>(body: () => Promise<A>): Promise<A> {
        const actual = Promise.resolve()
          .then(() => {
            check();
            return body();
          })
          .then((value) => {
            check();
            return value;
          });
        const observed = actual.then(
          () => undefined,
          () => undefined,
        );
        pending.add(observed);
        void observed.then(() => pending.delete(observed));
        return actual;
      }
      function close(handleId: string): Promise<void> {
        if (closePromise !== undefined) return closePromise;
        active = false;
        stop.abort();
        closePromise = (async () => {
          const closed = await Promise.allSettled([
            Promise.resolve().then(() =>
              runNative(cleanup.call(HostNativeHandles.close, { handleId }, true)),
            ),
            ...[...readers].map((reader) =>
              Promise.resolve().then(() =>
                reader.cancel(new OfficeUnavailable(safeFailure("AUTHORITY_LOST"))),
              ),
            ),
          ]);
          await Promise.all(pending);
          const drained = await Promise.allSettled([
            Promise.resolve().then(() => manifest.drain()),
            Promise.resolve().then(() => binary.drain()),
            Promise.resolve().then(() => cleanup.drain()),
          ]);
          if ([...closed, ...drained].some((result) => result.status === "rejected"))
            throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
        })();
        return closePromise;
      }
      if (
        (target.scope.kind === "draft") !== (opened.worktreeId !== null) ||
        (target.scope.kind === "main" && opened.baselineRevision !== null)
      )
        return yield* Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN")));
      const state: NativeSession = {
        access,
        target,
        policy,
        handleId: opened.handleId,
        worktreeId: opened.worktreeId,
        baselineRevision: opened.baselineRevision,
        readers,
        check,
        write() {
          check();
          if (access.kind === "read") throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        },
        call: (method, request, mutation) =>
          task(async () => {
            if (mutation) state.write();
            const result = await runNative(manifest.call(method, request, mutation), stop.signal);
            if (mutation && (!active || Date.now() >= opened.deadline))
              throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
            return result;
          }),
        // NativeValues registers/cancels each returned body before its post-IO check.
        exchange: (method, request, transfer) => {
          check();
          if (transfer.mutation) state.write();
          return runNative(binary.exchange(method, request, transfer), stop.signal);
        },
        task,
        own:
          (body) =>
          (...args) =>
            task(() => body(...args)),
        close: () => close(opened.handleId),
      };
      yield* Effect.try({
        try: () => check(target.owner.ownerId, target.unitId, opened.worktreeId ?? undefined),
        catch: adapterFailure,
      });
      const values = new NativeValues(state);
      return {
        core: createNativeCoreAdapter(state, values),
        worktrees: createNativeDraftAdapter(state, values),
      };
    });
  return { native, bytes: createNativeBytesClient(binary, manifest, policy) };
}
