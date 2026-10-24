import { Effect, Exit, Scope } from "effect";
import { withCause } from "@starter/diagnostics";
import { OfficeInvalid, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { createOfficeProtocol } from "@starter/office-server/native-protocol";
import type { makeNativeApplication } from "./native-app.ts";

type Application = Effect.Success<ReturnType<typeof makeNativeApplication>>;
type Protocol = ReturnType<typeof createOfficeProtocol>;
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Actual protocol/Scope cache. IDs select already authenticated Views; this cache grants no access. */
export const makeOfficeProtocolPool = Effect.fn("Office.protocolPool")(function* (
  application: Application,
  maximum: number,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64)
    return yield* Effect.fail(new OfficeInvalid(safeFailure("INVALID_INPUT")));
  const root = yield* Scope.make();
  const protocols = new Map<string, Promise<Protocol>>();
  let revoked = false;
  let cleanupFailure: Error | undefined, closing: Promise<void> | undefined;
  const check = () => {
    if (revoked || application.signal.aborted) throw unavailable();
  };
  function get(viewId: string): Promise<Protocol> {
    check();
    const previous = protocols.get(viewId);
    if (previous !== undefined) return previous;
    if (protocols.size >= maximum)
      return Promise.reject(new OfficeUnavailable(safeFailure("BUSY")));
    const actual = Promise.resolve().then(async () => {
      check();
      const scope = await Effect.runPromise(Scope.fork(root));
      try {
        check();
        const protocol = await Effect.runPromise(
          application.protocol(viewId).pipe(Scope.provide(scope)),
        );
        check();
        return protocol;
      } catch (cause) {
        try {
          await Effect.runPromise(Scope.close(scope, Exit.void));
        } catch (cleanupCause) {
          cleanupFailure ??= withCause(unavailable(), cleanupCause);
        }
        throw cause;
      }
    });
    protocols.set(viewId, actual);
    // Observe immediately; failed creation never leaves a bogus usable protocol in the cache.
    void actual.then(
      () => undefined,
      () => protocols.delete(viewId),
    );
    return actual;
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    revoked = true;
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled(protocols.values());
      await Effect.runPromise(Scope.close(root, Exit.void));
      protocols.clear();
      if (cleanupFailure !== undefined) throw cleanupFailure;
      return undefined;
    });
    return closing;
  }
  yield* Effect.addFinalizer(() => Effect.promise(close));
  return Object.freeze({
    get,
    revoke: () => {
      revoked = true;
    },
    close,
  });
});
