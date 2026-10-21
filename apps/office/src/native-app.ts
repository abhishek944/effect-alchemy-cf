import { Effect, Exit, Scope } from "effect";
import {
  OfficeForbidden,
  OfficeInvalid,
  OfficeUnavailable,
  decodeWire,
  safeFailure,
} from "@starter/office-contract";
import { composeOffice, makeNativeRuntime, type OfficeNativeRuntime } from "@starter/office-server";
import { HostPolicy } from "@starter/office-server/native-remote";
import { resolveNativeView } from "./native-app-view.ts";
import {
  OwnerClaims,
  type OfficeDependencies,
  type OwnerScope,
  type ViewRecord,
} from "@starter/office-server/ports";
import {
  createOfficeProtocol,
  type OfficeProtocolAuthority,
  type OfficeViewProtocol,
  type OfficeSubmissionAuthority,
} from "@starter/office-server/native-protocol";

type Protocol = ReturnType<typeof createOfficeProtocol>;
export type NativeApplicationOptions = {
  readonly dependencies: OfficeDependencies;
  readonly owner: OwnerScope;
  readonly maxProtocols: number;
  readonly bindAuthority: (context: {
    readonly runtime: OfficeNativeRuntime;
    readonly view: ViewRecord;
    readonly signal: AbortSignal;
    readonly joinedSession: Protocol["joinedSession"];
  }) => {
    readonly authority: OfficeProtocolAuthority;
    readonly views: OfficeViewProtocol;
    readonly submissions: OfficeSubmissionAuthority;
  };
};
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));

/** Node-only composition. Scope owns SDK resources, never caller-owned providers or process ingress. */
export const makeNativeApplication = Effect.fn("Office.makeNativeApplication")(function* (
  options: NativeApplicationOptions,
) {
  const policy = yield* decodeWire(HostPolicy)(options.dependencies.policy).pipe(
    Effect.mapError(() => new OfficeInvalid(safeFailure("EXECUTOR_UNCONFIGURED"))),
  );
  const owner = Object.freeze(
    yield* decodeWire(OwnerClaims)(options.owner).pipe(
      Effect.mapError(() => new OfficeInvalid(safeFailure("INVALID_INPUT"))),
    ),
  );
  const maxProtocols = options.maxProtocols;
  if (!Number.isSafeInteger(maxProtocols) || maxProtocols < 1 || maxProtocols > 64)
    return yield* Effect.fail(new OfficeInvalid(safeFailure("INVALID_INPUT")));
  const bindAuthority = options.bindAuthority;
  if (typeof bindAuthority !== "function") return yield* Effect.fail(forbidden());
  const deps: OfficeDependencies = Object.freeze({
    ...options.dependencies,
    policy: Object.freeze({ ...policy, limits: Object.freeze({ ...policy.limits }) }),
  });
  const stop = new AbortController();
  const resources = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
    Effect.sync(() => stop.abort()).pipe(Effect.andThen(Scope.close(scope, exit))),
  );
  let count = 0;
  const initialize = Effect.gen(function* () {
    const runtime = yield* makeNativeRuntime(deps);
    const office = composeOffice(deps, runtime);
    const protocol = Effect.fn("Office.app.protocol")(function* (viewId: string) {
      const scope = yield* Effect.acquireRelease(Scope.fork(resources), (child, exit) =>
        Scope.close(child, exit),
      );
      const acquire = Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              if (stop.signal.aborted) throw unavailable();
              if (count >= maxProtocols) throw new OfficeUnavailable(safeFailure("BUSY"));
              count++;
            },
            catch: (cause) => (cause instanceof OfficeUnavailable ? cause : unavailable()),
          }),
          () =>
            Effect.sync(() => {
              count--;
            }),
        );
        const view = yield* resolveNativeView(deps, owner, viewId, stop.signal);
        const services = yield* runtime.services(view.target);
        const revoked = new AbortController();
        let installed: Protocol | null = null;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => revoked.abort()).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                const current = installed;
                return current === null ? Effect.void : Effect.promise(() => current.dispose());
              }),
            ),
          ),
        );
        if (stop.signal.aborted) return yield* Effect.fail(unavailable());
        const bound = bindAuthority({
          runtime,
          view,
          signal: AbortSignal.any([stop.signal, revoked.signal]),
          joinedSession: (...args) => {
            if (installed === null) throw unavailable();
            return installed.joinedSession(...args);
          },
        });
        const value = yield* Effect.sync(() => {
          if (stop.signal.aborted || revoked.signal.aborted) throw unavailable();
          installed = createOfficeProtocol(
            services,
            bound.authority,
            bound.views,
            bound.submissions,
          );
          return installed;
        });
        yield* resolveNativeView(deps, owner, viewId, stop.signal);
        return value;
      }).pipe(Scope.provide(scope));
      return yield* acquire.pipe(
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
      );
    });
    return Object.freeze({ office, protocol, signal: stop.signal });
  }).pipe(Scope.provide(resources));
  return yield* initialize.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(resources, exit) : Effect.void)),
  );
});
