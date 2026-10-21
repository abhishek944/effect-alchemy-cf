import type { IncomingMessage, ServerResponse } from "node:http";
import { UniverCollabService } from "@univerjs-pro/collaboration-service";
import { UniverCollabEndpoint } from "@univerjs-pro/collaboration-endpoint";
import { createNodeTransport } from "@univerjs-pro/collaboration-transport-node";
import { createReadonlyDocDatabase } from "@starter/office-server/native-doc-read";
import { classifyNativeRoute } from "@starter/office-server/native-protocol";
import { UniverType } from "@univerjs/protocol";
import type { OfficeReadonlyHostOptions } from "./host.ts";

const snapshot = "/universer-api/snapshot/:type/unit/:unitID/rev/:revision";
const noop = () => {};
export type ReadRoute = NonNullable<ReturnType<typeof classifyNativeRoute>>;
export type HostRequest = { readonly done: Promise<void>; stop(): void };

/** No body parsing or alternate native response encoder at this boundary. */
export function createHostRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: OfficeReadonlyHostOptions,
): HostRequest {
  const controller = new AbortController();
  const deadline = Date.now() + options.requestTimeoutMs;
  let finishResponse = noop;
  const responseDone = new Promise<void>((resolve) => {
    finishResponse = resolve;
  });
  const stop = () => {
    controller.abort();
    if (!response.writableFinished) response.destroy();
  };
  const settled = () => {
    controller.abort();
    finishResponse();
  };
  response.once("finish", settled);
  response.once("close", settled);
  response.once("error", stop);
  request.once("aborted", stop);
  request.once("error", stop);
  if (response.destroyed || response.writableFinished) settled();
  else if (request.destroyed && !request.complete) stop();
  let timer = setTimeout(stop, options.requestTimeoutMs);
  timer.unref();
  const reject = (status: number) => {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) return stop();
    response.writeHead(status, {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      connection: "close",
    });
    response.end("Office read unavailable");
  };
  const done = (async () => {
    const dispose: Array<() => Promise<void>> = [];
    const failures: unknown[] = [];
    let signal = controller.signal;
    try {
      const url = request.url;
      const route = classifyNativeRoute(request.method ?? "", url ?? "");
      const revision = Number(route?.params.revision);
      if (
        route?.template !== snapshot ||
        route.params.type !== String(UniverType.UNIVER_DOC) ||
        route.params.unitID !== options.target.unitId ||
        url?.includes("?") ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        reject(404);
        return;
      }
      if (
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) {
        reject(400);
        return;
      }
      controller.signal.throwIfAborted();
      const authorized = await options.authorizeRead(request, route, controller.signal);
      controller.signal.throwIfAborted();
      const access = structuredClone(authorized.access);
      const target = access.target;
      if (
        access.kind !== "read" ||
        target.scope.kind !== "main" ||
        target.owner.stage !== options.target.owner.stage ||
        target.owner.ownerId !== options.target.owner.ownerId ||
        target.documentId !== options.target.documentId ||
        target.unitId !== options.target.unitId ||
        authorized.revision !== revision ||
        request.method !== "GET" ||
        request.url !== url ||
        !(authorized.signal instanceof AbortSignal)
      )
        throw new Error("Read delegation does not match this host request");
      signal = AbortSignal.any([controller.signal, authorized.signal]);
      signal.addEventListener("abort", stop, { once: true });
      const expiresAt = Math.min(deadline, authorized.expiresAt);
      const check = () => {
        if (signal.aborted || Date.now() >= expiresAt) {
          stop();
          throw new Error("Read delegation expired or revoked");
        }
      };
      check();
      clearTimeout(timer);
      timer = setTimeout(stop, expiresAt - Date.now());
      timer.unref();
      const grant = { ...authorized, access, signal, expiresAt, policy: { ...authorized.policy } };
      const database = createReadonlyDocDatabase(grant);
      dispose.push(async () => database.dispose?.());
      const service = new UniverCollabService({ dbAdapter: database, snapshotPolicy: false });
      dispose.push(() => service.dispose());
      service.use("readUnitData", async (context, next) => {
        check();
        if (
          context.userID !== target.owner.ownerId ||
          context.request.unitID !== target.unitId ||
          context.request.type !== UniverType.UNIVER_DOC ||
          !("revision" in context.request) ||
          context.request.revision !== revision
        )
          throw new Error("Read scope mismatch");
        await next();
        check();
      });
      const endpoint = new UniverCollabEndpoint(service);
      dispose.push(() => endpoint.dispose());
      const transport = createNodeTransport({ maxRequestBodyBytes: 1 });
      dispose.push(() => transport.dispose());
      let finishWork = noop;
      const middlewareDone = new Promise<void>((resolve) => {
        finishWork = resolve;
      });
      transport.use((context, next) => {
        const work = (async () => {
          check();
          context.userID = target.owner.ownerId;
          context.customData.officeReadId = grant.requestId;
          await next();
          check();
        })();
        void work.then(finishWork, finishWork);
        return work;
      });
      let registered = false;
      // This wrapper owns no dispose hook: Endpoint and Service are owned above.
      transport.register({
        register(router) {
          endpoint.register({
            get(path, handler) {
              if (path === snapshot) {
                registered = true;
                router.get(path, handler);
              }
            },
            post() {},
            delete() {},
            upgrade() {},
          });
        },
      });
      if (!registered) throw new Error("SDK snapshot route unavailable");
      check();
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("connection", "close");
      transport.handleRequest(request, response); // void; middlewareDone joins real next() work.
      await middlewareDone;
    } catch {
      if (!controller.signal.aborted) reject(403);
    } finally {
      await responseDone;
      stop();
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      response.off("finish", settled);
      response.off("close", settled);
      response.off("error", stop);
      request.off("aborted", stop);
      request.off("error", stop);
      for (const release of dispose.toReversed()) {
        try {
          await release();
        } catch (cause) {
          failures.push(cause);
        }
      }
    }
    if (failures.length) throw new AggregateError(failures, "Office read cleanup failed");
  })();
  return { done, stop };
}
