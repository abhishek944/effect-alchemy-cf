import { createServer, type Server } from "node:http";
import { Effect, Exit, Schema } from "effect";
import { OfficeInvalid, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { MakeOfficeNodeServer, OfficeNodeServerOptions } from "./native-listener-types.ts";
import { makeNativeServerIO, NativeServerOptions } from "./native-server-io.ts";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
function capture(options: OfficeNodeServerOptions) {
  const value = Schema.decodeUnknownSync(NativeServerOptions)(options),
    handlers = value.handlers;
  return Object.freeze({
    ...value,
    handlers: Object.freeze({
      request: handlers.request.bind(handlers),
      upgrade: handlers.upgrade.bind(handlers),
      revoke: handlers.revoke.bind(handlers),
      drain: handlers.drain.bind(handlers),
    }),
  });
}
function lifetime(config: OfficeNodeServerOptions) {
  const root = new AbortController(),
    errors: unknown[] = [];
  let server: Server | undefined, opening: Promise<void> | undefined;
  let closed: Promise<void> | undefined,
    bound = false,
    physicallyClosed = false;
  let closing: Promise<void> | undefined;
  function failed(cause: unknown) {
    errors.push(cause);
    void close().catch(() => undefined); // Observe immediately; public close still retains its rejection.
  }
  const io = makeNativeServerIO(config, root.signal, failed);
  function stopAcceptor() {
    const actual = server;
    if (actual === undefined) return Promise.resolve();
    const stopped = new Promise<void>((resolve) =>
      io.attempt(() =>
        actual.close((error) => {
          if (
            error &&
            !(
              "code" in error &&
              error.code === "ERR_SERVER_NOT_RUNNING" &&
              (!bound || physicallyClosed)
            )
          )
            errors.push(error);
          resolve();
        }),
      ),
    );
    io.attempt(() => actual.closeAllConnections()); // Raw upgrades are ALSO separately owned by io.
    if (!bound) return stopped;
    if (closed === undefined) throw new Error("Bound listener close observer is absent");
    return Promise.all([stopped, closed]).then(() => undefined);
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    let settle: ((result: Promise<void>) => void) | undefined;
    closing = new Promise<void>((resolve) => {
      settle = resolve;
    });
    if (settle === undefined) throw new Error("Listener close observer was not installed");
    void closing.catch(() => undefined);
    io.attempt(() => root.abort());
    io.attempt(() => config.handlers.revoke());
    io.stop();
    settle(
      (async () => {
        await opening; // Actual listen attempt, never a logical abort race.
        const joined = await Promise.allSettled([Promise.resolve().then(stopAcceptor), io.drain()]);
        for (const result of joined) if (result.status === "rejected") errors.push(result.reason);
        await io.drain(); // Catch late IO registered before the acceptor actually stopped.
        const drained = await Promise.allSettled([
          Promise.resolve().then(() => config.handlers.drain()),
        ]);
        for (const result of drained) if (result.status === "rejected") errors.push(result.reason);
        if (errors.length) throw new AggregateError(errors, "Office listener cleanup failed");
      })(),
    );
    return closing;
  }
  const interrupted = () => {
    void close().catch(() => undefined);
  };
  async function open(signal: AbortSignal) {
    signal.addEventListener("abort", interrupted, { once: true });
    try {
      if (signal.aborted || root.signal.aborted) throw unavailable();
      const actual = createServer({
        maxHeaderSize: config.maxHeaderBytes,
        headersTimeout: config.headersTimeoutMs,
        requestTimeout: config.requestTimeoutMs,
        connectionsCheckingInterval: Math.min(config.headersTimeoutMs, config.requestTimeoutMs),
        keepAliveTimeout: config.requestTimeoutMs,
        keepAliveTimeoutBuffer: 0,
      });
      server = actual;
      closed = new Promise<void>((resolve) =>
        actual.once("close", () => {
          physicallyClosed = true;
          resolve();
          if (!root.signal.aborted) failed(new Error("Office listener closed unexpectedly"));
        }),
      );
      actual.on("listening", () => {
        bound = true;
      });
      actual.on("error", failed);
      // IO observes every accepted socket before applying the configured cap, including refused ones.
      actual.maxHeadersCount = config.maxHeadersCount;
      actual.on("connection", io.connection);
      actual.on("request", io.request);
      actual.on("checkContinue", io.request);
      actual.on("checkExpectation", io.request);
      actual.on("upgrade", io.upgrade);
      actual.on("connect", (_request, socket) => io.cancel(socket));
      actual.on("clientError", (_error, socket) => io.cancel(socket));
      const binding = Promise.resolve().then(
        () =>
          new Promise<void>((resolve, reject) => {
            const finish = (error?: unknown) => {
              actual.off("listening", ready);
              actual.off("error", rejected);
              actual.off("close", cancelled);
              if (error === undefined) resolve();
              else reject(error);
            };
            const ready = () => finish(),
              rejected = (error: Error) => finish(error);
            const cancelled = () => finish(unavailable());
            actual.once("listening", ready);
            actual.once("error", rejected);
            actual.once("close", cancelled);
            try {
              if (root.signal.aborted) throw unavailable();
              actual.listen({ host: config.host, port: config.port, exclusive: true });
            } catch (cause) {
              finish(cause);
            }
          }),
      );
      opening = binding.then(
        () => undefined,
        () => undefined,
      );
      await binding;
      const address = actual.address();
      if (root.signal.aborted || address === null || typeof address === "string")
        throw unavailable();
      return Object.freeze({ address: Object.freeze({ ...address }), signal: root.signal, close });
    } finally {
      signal.removeEventListener("abort", interrupted);
    }
  }
  return { open, close };
}
export const makeOfficeNodeServer: MakeOfficeNodeServer = Effect.fn("Office.nodeServer")(
  function* (options) {
    const config = yield* Effect.try({
      try: () => capture(options),
      catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
    });
    const owned = yield* Effect.acquireRelease(
      Effect.sync(() => lifetime(config)),
      (value) => Effect.promise(value.close),
    );
    return yield* Effect.tryPromise({
      try: (signal) => owned.open(signal),
      catch: unavailable,
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Effect.promise(owned.close) : Effect.void)),
    );
  },
);
