import type * as cf from "@cloudflare/workers-types";
import { Effect, Exit, Schema, Scope } from "effect";
import { OfficeUnavailable, decodeWireSync, safeFailure } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import type { HostPolicy } from "@starter/office-server/native-remote";
import { makeOfficeContainerLifetime } from "./office-container-lifetime.ts";
import { officeNativeRequest } from "./office-platform.ts";

const unknown = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
const Ready = Schema.Struct({
  bootId: Schema.String,
  processId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  address: Schema.Struct({ address: Schema.String, port: Schema.Literal(8080) }),
});
type Lifetime = Effect.Success<ReturnType<typeof makeOfficeContainerLifetime>>;
/** Actual one owned process/image/listener bootstrap. Callback handlers await acquisition ONLY,
 * never the ready/activate promise (which would self-deadlock with their own callback).
 */
export function officeHostProcess(
  state: cf.DurableObjectState,
  scope: Scope.Closeable,
  imageRef: string,
  owner: OwnerScope,
  policy: typeof HostPolicy.Type,
  storage: cf.Fetcher,
) {
  let acquisition: Promise<Lifetime> | undefined;
  let starting: Promise<Lifetime> | undefined;
  let closing: Promise<void> | undefined;
  let acceptedReady = false;
  let resolveGone: (() => void) | undefined;
  const actualGone = new Promise<void>((resolve) => {
    resolveGone = resolve;
  });
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: unknown) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  const start = (): Promise<Lifetime> => {
    if (closing !== undefined) return Promise.reject(unknown());
    if (starting !== undefined) return starting;
    // Publish before resource acquisition/start, so callbacks can join this exact acquisition.
    acquisition = Promise.resolve().then(() =>
      Effect.runPromise(
        Scope.provide(
          makeOfficeContainerLifetime({ state, imageRef, owner, policy, storage }),
          scope,
        ),
      ),
    );
    void acquisition.catch(() => undefined);
    timer = setTimeout(() => rejectReady?.(unknown()), 30_000);
    starting = Promise.resolve().then(async () => {
      const resource = await acquisition;
      if (resource === undefined) throw unknown();
      await ready;
      if (closing !== undefined) throw unknown();
      await resource.activate(); // Actual inspect.image + original boot checked again by frozen lifetime.
      return resource;
    });
    return starting;
  };
  return {
    start,
    async peer(bootId: string | null, cleanup: boolean) {
      if (acquisition === undefined || (!cleanup && closing !== undefined)) throw unknown();
      const resource = await acquisition;
      if (bootId !== resource.bootId) throw unknown(); // Correlation, NOT the peer proof.
      const native = state.container;
      if (native === undefined || (!cleanup && !native.running)) throw unknown();
      const current = await native.inspect();
      if (current === null) {
        if (!cleanup) throw unknown(); // Original cleanup only after stopped process; NEVER a work grant.
      } else if (current.image !== imageRef || current.labels["office-boot"] !== resource.bootId)
        throw unknown();
      return resource;
    },
    async ready(bootId: string | null, payload: unknown) {
      const resource = await this.peer(bootId, false);
      const actual = decodeWireSync(Ready)(payload);
      if (
        acceptedReady ||
        actual.bootId !== resource.bootId ||
        actual.address.address !== "0.0.0.0"
      )
        throw unknown();
      // This arrives via the ORIGINAL container outbound binding from the fixed pinned entry,
      // after its real host/listener Scope acquired. PID/address are descriptive, not attestation.
      acceptedReady = true;
      clearTimeout(timer);
      resolveReady?.();
    },
    async request(request: Request) {
      const resource = await start();
      return resource.request(officeNativeRequest(request));
    },
    close() {
      if (closing !== undefined) return closing;
      closing = Promise.resolve().then(async () => {
        clearTimeout(timer);
        rejectReady?.(unknown());
        await acquisition?.catch(() => undefined);
        // Caller gracefully stops/joins actual Node handlers and Worker callbacks FIRST.
        await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
        resolveGone?.(); // Actual owned destroy/monitor/start/task Scope joined; NEVER just stop.signal.
        return undefined;
      });
      return closing;
    },
    actualGone,
    get signal(): Promise<AbortSignal> {
      return acquisition === undefined
        ? Promise.reject(unknown())
        : acquisition.then((resource) => resource.signal);
    },
    get bootId(): Promise<string> {
      return acquisition === undefined
        ? Promise.reject(unknown())
        : acquisition.then((resource) => resource.bootId);
    },
  };
}
export type OfficeHostProcess = ReturnType<typeof officeHostProcess>;
