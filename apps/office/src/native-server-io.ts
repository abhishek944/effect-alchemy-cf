import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { Socket, isIP } from "node:net";
import { Predicate, Schema } from "effect";
import type { OfficeNodeHandlers, OfficeNodeServerOptions } from "./native-listener-types.ts";

const bounded = (min: number, max: number) =>
  Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }));
export const NativeServerOptions = Schema.Struct({
  host: Schema.String.check(Schema.makeFilter((host) => isIP(host) !== 0)),
  port: bounded(1, 65_535),
  maxConnections: bounded(1, 256),
  maxRequests: bounded(1, 256),
  maxHeaderBytes: bounded(1024, 65_536),
  maxHeadersCount: bounded(1, 128),
  headersTimeoutMs: bounded(1, 60_000),
  requestTimeoutMs: bounded(1, 600_000),
  handlers: Schema.declare<OfficeNodeHandlers>(
    (value): value is OfficeNodeHandlers =>
      Predicate.isObject(value) &&
      ["request", "upgrade", "revoke", "drain"].every((key) => typeof value[key] === "function"),
  ),
});

function terminal(
  stream: IncomingMessage | ServerResponse,
  event: "end" | "finish" | "close",
  ended: boolean,
  cancel: () => void,
): Promise<void> {
  if (stream.closed) return Promise.resolve();
  stream.on("error", cancel);
  stream.once("close", () => stream.off("error", cancel));
  if (ended) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      stream.off(event, done);
      stream.off("close", done);
      resolve();
    };
    if (event !== "close") stream.once(event, done);
    stream.once("close", done);
  });
}

type Dispatch = { response: ServerResponse } | { socket: Duplex; head: Buffer };
/** Own physical IO; handler settlement, HTTP EOF and raw socket close are different events. */
export function makeNativeServerIO(
  config: OfficeNodeServerOptions,
  root: AbortSignal,
  failed: (cause: unknown) => void,
) {
  const sockets = new Map<Duplex, Promise<void>>();
  const pending = new Set<Promise<void>>();
  const cancellations = new Set<() => void>();
  let admitted = 0;
  const attempt = (action: () => unknown) => {
    try {
      action();
    } catch (cause) {
      failed(cause);
    }
  };
  const track = (actual: Promise<void>) => {
    const observed = actual.then(() => undefined, failed);
    pending.add(observed);
    void observed.then(() => pending.delete(observed));
    return observed;
  };
  function connection(socket: Duplex) {
    if (sockets.has(socket) || socket.closed) return;
    const cancel = () => attempt(() => socket.destroy());
    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        socket.off("error", cancel);
        if (socket instanceof Socket) {
          attempt(() => socket.setTimeout(0));
          socket.off("timeout", cancel);
        }
        sockets.delete(socket);
        resolve();
      });
    });
    sockets.set(socket, closed);
    socket.on("error", cancel);
    if (socket instanceof Socket) attempt(() => socket.setTimeout(config.requestTimeoutMs, cancel));
    if (root.aborted || sockets.size > config.maxConnections) cancel();
  }
  function dispatch(request: IncomingMessage, input: Dispatch) {
    const socket = "response" in input ? request.socket : input.socket;
    connection(socket);
    const controller = new AbortController();
    const signal = AbortSignal.any([root, controller.signal]);
    const cancel = () => {
      attempt(() => controller.abort());
      attempt(() => request.destroy());
      if ("response" in input) attempt(() => input.response.destroy());
      attempt(() => socket.destroy());
    };
    cancellations.add(cancel);
    socket.once("close", cancel);
    const body =
      "response" in input
        ? terminal(request, "end", request.readableEnded, cancel)
        : terminal(request, "close", request.closed, cancel);
    // The upgrade body/head belongs to the raw socket, but header cancellation still joins close.
    if (!("response" in input)) void track(body);
    const response =
      "response" in input
        ? terminal(input.response, "finish", input.response.writableFinished, cancel)
        : Promise.resolve();
    request.on("aborted", cancel);
    const accepted = !root.aborted && !socket.destroyed && admitted < config.maxRequests;
    if (accepted) admitted++;
    const timeout = setTimeout(cancel, config.requestTimeoutMs);
    timeout.unref();
    // Registration and its rejection observer precede any external handler code, including sync throws.
    const handler = Promise.resolve()
      .then(() => {
        if (!accepted || root.aborted) {
          cancel();
          return undefined;
        }
        return "response" in input
          ? config.handlers.request(request, input.response, signal)
          : config.handlers.upgrade(request, socket, input.head, signal);
      })
      .then(() => undefined, cancel);
    const done = handler
      .then(async () => {
        await response;
        if ("response" in input && !request.readableEnded && !request.closed)
          attempt(() => request.destroy());
        if ("response" in input) await body;
        return undefined;
      })
      .then(() => {
        clearTimeout(timeout);
        if (accepted) admitted--;
        request.off("aborted", cancel);
        if ("response" in input || socket.closed) {
          socket.off("close", cancel);
          cancellations.delete(cancel);
        } else {
          socket.once("close", () => cancellations.delete(cancel));
        }
        return undefined;
      });
    void track(done);
  }
  return {
    connection,
    attempt,
    request: (request: IncomingMessage, response: ServerResponse) =>
      dispatch(request, { response }),
    upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) =>
      dispatch(request, { socket, head }),
    cancel: (socket: Duplex) => {
      connection(socket);
      attempt(() => socket.destroy());
    },
    stop() {
      for (const cancel of cancellations) attempt(cancel);
      for (const socket of sockets.keys()) attempt(() => socket.destroy());
    },
    async drain() {
      // Recheck after settlement: late close callbacks can register additional owned cancellation work.
      while (pending.size || sockets.size) await Promise.all([...pending, ...sockets.values()]);
    },
  };
}
