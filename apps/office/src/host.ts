import { createServer, type IncomingMessage } from "node:http";
import { isIP, type AddressInfo, type Socket } from "node:net";
import type { NativeTarget } from "@starter/office-server/ports";
import type { DocReadOptions } from "@starter/office-server/native-doc-read";
import { createHostRequest, type HostRequest, type ReadRoute } from "./host-request.ts";

export type OfficeReadonlyHostOptions = {
  readonly target: NativeTarget;
  readonly host: string;
  readonly port: number;
  readonly maxConcurrentRequests: number;
  readonly requestTimeoutMs: number;
  /** Required genuine private Worker delegation; no claims/header-based default is supplied. */
  readonly authorizeRead: (
    request: IncomingMessage,
    route: ReadRoute,
    signal: AbortSignal,
  ) => Promise<DocReadOptions>;
};
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
function capture(options: OfficeReadonlyHostOptions): OfficeReadonlyHostOptions {
  const target = structuredClone(options.target);
  if (
    target?.scope?.kind !== "main" ||
    ![target.owner?.stage, target.owner?.ownerId, target.documentId, target.unitId].every(
      (value) => typeof value === "string" && value.length > 0 && value.length <= 256,
    ) ||
    typeof options.host !== "string" ||
    isIP(options.host) === 0 ||
    !Number.isSafeInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535 ||
    !positive(options.maxConcurrentRequests) ||
    !positive(options.requestTimeoutMs) ||
    options.requestTimeoutMs > 2_147_483_647 ||
    typeof options.authorizeRead !== "function"
  )
    throw new TypeError("Explicit main target, IP, port, limits and resolver are required");
  Object.freeze(target.owner);
  Object.freeze(target.scope);
  Object.freeze(target);
  return Object.freeze({
    target,
    host: options.host,
    port: options.port,
    maxConcurrentRequests: options.maxConcurrentRequests,
    requestTimeoutMs: options.requestTimeoutMs,
    authorizeRead: options.authorizeRead,
  });
}

/** Listener assembly only. The caller must supply actual delegated View/session/placement authority. */
export async function createOfficeReadonlyHost(options: OfficeReadonlyHostOptions): Promise<{
  readonly address: AddressInfo;
  close(): Promise<void>;
}> {
  const config = capture(options);
  const requests = new Set<HostRequest>(),
    sockets = new Map<Socket, Promise<void>>();
  let closed = false,
    started = false,
    cleanupFailed = false;
  let cleanupError: unknown;
  let closing: Promise<void> | undefined;
  const server = createServer(
    {
      requestTimeout: config.requestTimeoutMs,
      headersTimeout: config.requestTimeoutMs,
      connectionsCheckingInterval: Math.min(1_000, config.requestTimeoutMs),
      maxHeaderSize: 16 * 1024,
    },
    (request, response) => {
      if (closed || requests.size >= config.maxConcurrentRequests) {
        response.destroy();
        return;
      }
      const active = createHostRequest(request, response, config);
      requests.add(active);
      void active.done.then(
        () => requests.delete(active),
        (cause: unknown) => {
          cleanupFailed = true;
          cleanupError = cause;
          requests.delete(active);
        },
      );
    },
  );
  server.maxConnections = config.maxConcurrentRequests;
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    closed = true;
    closing = (async () => {
      const stopped = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")) reject(error);
          else resolve();
        });
      });
      // Revoke every grant before joining any real resolver, SDK work or server shutdown.
      for (const request of requests) request.stop();
      for (const socket of sockets.keys()) socket.destroy();
      const results = await Promise.allSettled([
        stopped,
        ...sockets.values(),
        ...[...requests].map((request) => request.done),
      ]);
      server.removeAllListeners();
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (cleanupFailed) throw new Error("Office host cleanup failed", { cause: cleanupError });
    })();
    return closing;
  };
  server.on("connection", (socket) => {
    if (closed) {
      socket.destroy();
      return;
    }
    const disconnect = () => socket.destroy();
    socket.setTimeout(config.requestTimeoutMs, disconnect);
    socket.on("error", disconnect);
    sockets.set(
      socket,
      new Promise<void>((resolve) => {
        socket.once("close", () => {
          socket.setTimeout(0);
          socket.off("timeout", disconnect);
          socket.off("error", disconnect);
          sockets.delete(socket);
          resolve();
        });
      }),
    );
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("error", () => {
    if (started) void close().catch(() => undefined);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        server.off("listening", ready);
        server.off("error", failed);
        reject(error);
      };
      const ready = () => {
        server.off("error", failed);
        started = true;
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      try {
        server.listen({ host: config.host, port: config.port, exclusive: true });
      } catch (cause) {
        server.off("error", failed);
        server.off("listening", ready);
        reject(cause);
      }
    });
    const address = server.address();
    if (closed || address === null || typeof address === "string")
      throw new Error("Office host did not bind the requested IP listener");
    return Object.freeze({ address: Object.freeze({ ...address }), close });
  } catch (cause) {
    await close();
    throw cause;
  }
}
