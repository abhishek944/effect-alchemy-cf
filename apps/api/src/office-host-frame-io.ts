import { withCause } from "@starter/diagnostics";
import { officeDenied, type OfficePrivateIO } from "./office-private-authority.ts";

/** Actual promises/readers/bodies, not map-emptiness or cancellation acknowledgements as a seal. */
export function officeHostFrameIO() {
  const work = new Set<OfficePrivateIO>(),
    cleanup = new Set<OfficePrivateIO>();
  const pending = new Set<Promise<void>>();
  let revoked = false,
    stopped = false,
    failed = false;
  let failureCause: unknown;
  const fail = (cause: unknown) => {
    if (!failed) failureCause = cause;
    failed = true;
  };
  const observe = (actual: Promise<unknown>, physical: boolean) => {
    const joined = actual.then(
      () => undefined,
      (cause) => {
        if (physical) fail(cause);
        return undefined;
      },
    );
    pending.add(joined);
    void joined.then(() => pending.delete(joined));
  };
  const close = (resource: OfficePrivateIO) =>
    observe(
      Promise.resolve().then(() => resource.close()),
      true,
    );
  return {
    hold(resource: OfficePrivateIO, isCleanup: boolean): void {
      const resources = isCleanup ? cleanup : work;
      resources.add(resource);
      const actual = resource.drain().then(
        () => {
          resources.delete(resource);
          return undefined;
        },
        (cause) => {
          fail(cause);
          resources.delete(resource);
          return undefined;
        },
      );
      observe(actual, true);
      if (stopped || (!isCleanup && revoked)) close(resource);
    },
    track<A>(body: () => Promise<A>): Promise<A> {
      const actual = Promise.resolve().then(body);
      observe(actual, false); // Domain failure is not a physical cleanup certificate or IO failure.
      return actual;
    },
    revokeWork(): void {
      revoked = true;
      for (const resource of work) close(resource);
    },
    stop(): void {
      stopped = true;
      for (const resource of [...work, ...cleanup]) close(resource);
    },
    async drain(): Promise<void> {
      // Every entry observes the actual foreign promise before it can run. Late cleanup is retained.
      while (pending.size > 0) await Promise.all(pending);
      if (failed) throw withCause(officeDenied(), failureCause);
    },
    get failed() {
      return failed;
    },
    get isRevoked() {
      return revoked || stopped;
    },
  };
}
