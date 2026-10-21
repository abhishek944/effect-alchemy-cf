import type * as cf from "@cloudflare/workers-types";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { HostPolicy } from "@starter/office-server/native-remote";
import { OwnerClaims, type OwnerScope } from "@starter/office-server/ports";
import { Effect, Exit } from "effect";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const storageHost = "office-storage.internal";
const credentials = [
  "cookie",
  "authorization",
  "proxy-authorization",
  "cf-access-jwt-assertion",
  "cf-access-client-id",
  "cf-access-client-secret",
];
type Options = {
  readonly state: cf.DurableObjectState;
  /** Actual configured immutable application image, NEVER a Node report or source/base hash. */
  readonly imageRef: string;
  readonly owner: OwnerScope;
  readonly policy: typeof HostPolicy.Type;
  /** Real private Worker binding. Its handler authenticates original process/context on EACH call. */
  readonly storage: cf.Fetcher;
};

function lifetime(options: Options) {
  const state = options.state;
  const storage = options.storage;
  const configured = state.container;
  if (configured === undefined) throw unavailable();
  const native = configured;
  const owner = Object.freeze(decodeWireSync(OwnerClaims)(structuredClone(options.owner)));
  const policy = decodeWireSync(HostPolicy)(structuredClone(options.policy));
  const imageRef = options.imageRef;
  if (
    !/^registry\.cloudflare\.com\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(imageRef) ||
    imageRef.slice(imageRef.lastIndexOf("@") + 1) !== policy.imageDigest
  )
    throw forbidden();
  const bootId = crypto.randomUUID();
  const stop = new AbortController();
  let closed = false,
    active = false,
    owned = false;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let monitor: Promise<boolean> | undefined;
  let port: cf.Fetcher | undefined;
  const pending = new Set<Promise<void>>();
  function own<A>(body: () => Promise<A>): Promise<A> {
    const actual = Promise.resolve().then(body);
    const joined = actual.then(
      () => undefined,
      () => undefined,
    );
    pending.add(joined);
    void joined.then(() => pending.delete(joined));
    return actual;
  }
  const check = () => {
    if (closed || stop.signal.aborted) throw unavailable();
  };
  const watch = () =>
    Promise.resolve()
      .then(() => native.monitor())
      .then(
        () => true,
        () => false,
      )
      .then((clean) => {
        closed = true;
        active = false;
        stop.abort();
        return clean;
      });
  function start(): Promise<void> {
    if (starting !== undefined) return starting;
    starting = Promise.resolve().then(() =>
      state.blockConcurrencyWhile(async () => {
        check();
        if (native.running) throw unavailable(); // Never adopt another or revoked host.
        await native.interceptOutboundHttp(storageHost, storage);
        check();
        if (native.running) throw unavailable();
        native.start({
          enableInternet: false,
          entrypoint: [
            "node",
            "/opt/office/dependencies/packages/office-server/native-bootstrap.mjs",
          ],
          labels: { "office-boot": bootId },
          env: {
            OFFICE_BOOT_ID: bootId,
            OFFICE_STAGE: owner.stage,
            OFFICE_OWNER_ID: owner.ownerId,
            OFFICE_POLICY: JSON.stringify(policy),
            OFFICE_STORAGE_ORIGIN: `http://${storageHost}`,
          },
        });
        owned = true;
        monitor = watch();
        port = native.getTcpPort(8080);
        // End the startup block NOW; Node bootstrap/storage callbacks must run independently.
      }),
    );
    return starting;
  }
  function close(): Promise<void> {
    if (stopping !== undefined) return stopping;
    closed = true;
    active = false;
    stopping = Promise.resolve().then(async () => {
      await starting?.catch(() => undefined);
      if (!owned) return undefined;
      let failed = false,
        foreign = false;
      try {
        const current = await native.inspect();
        foreign = current !== null && current.labels["office-boot"] !== bootId;
        if (foreign) failed = true;
      } catch {
        failed = true;
      }
      if (!foreign) {
        try {
          await native.destroy();
        } catch {
          failed = true;
        }
      }
      if (monitor === undefined || !(await monitor)) failed = true;
      while (pending.size > 0) await Promise.all(pending);
      if (failed) throw unavailable();
      return undefined;
    });
    void stopping.catch(() => undefined);
    stop.abort();
    return stopping;
  }
  return Object.freeze({
    bootId,
    signal: stop.signal,
    start,
    close,
    /** AFTER caller verifies genuine bootstrap/process AND actual Node listener/app readiness. */
    activate(): Promise<void> {
      check();
      return own(async () => {
        check();
        const current = await native.inspect();
        check();
        if (
          !owned ||
          current === null ||
          current.image !== imageRef ||
          current.labels["office-boot"] !== bootId
        )
          throw forbidden();
        active = true;
      });
    },
    request(request: cf.Request): Promise<cf.Response> {
      check();
      return own(async () => {
        check();
        if (!active || port === undefined) throw unavailable();
        if (credentials.some((name) => request.headers.has(name))) throw forbidden();
        // One dispatch only. Root still owns envelope/Origin and actual response BODY joins/uncertainty.
        return port.fetch(request, { redirect: "manual" });
      });
    },
  });
}

/** One lifetime per DO; join its close before opening another. Scope owns BEFORE startup.
 * Caller first gracefully closes listener/host; providers/callback IO remain owned until actual drain.
 * Container monitor/destroy completion alone does NOT join outstanding Worker D1/R2 operations.
 */
export const makeOfficeContainerLifetime = Effect.fn("Office.container.lifetime")(function* (
  options: Options,
) {
  const resource = yield* Effect.acquireRelease(
    Effect.try({ try: () => lifetime(options), catch: unavailable }),
    (actual) => Effect.promise(() => actual.close()),
  );
  yield* Effect.tryPromise({ try: () => resource.start(), catch: unavailable }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) ? Effect.promise(() => resource.close()) : Effect.void,
    ),
  );
  return resource;
});
