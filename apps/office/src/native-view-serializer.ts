import type { IncomingMessage, ServerResponse } from "node:http";
import { finished } from "node:stream/promises";
import {
  UniverCollabService,
  type ISnapshotWithBlocks,
  type UnitRecord,
} from "@univerjs-pro/collaboration-service";
import { UniverCollabEndpoint } from "@univerjs-pro/collaboration-endpoint";
import { createNodeTransport } from "@univerjs-pro/collaboration-transport-node";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { createViewSnapshotDatabase } from "./native-view-database.ts";

const routes = new Set([
  "/universer-api/snapshot/:type/unit/:unitID/rev/:revision",
  "/universer-api/snapshot/:type/unit/:unitID/block/:blockID",
  "/universer-api/snapshot/block/:type/unit/:unitID/block/:blockID",
]);
/** Real public SDK HTTP serializers over the actual immutable artifact; no handwritten native success. */
export async function serializeViewSnapshot(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly viewId: string;
  readonly native: ISnapshotWithBlocks;
  readonly unit: UnitRecord;
  readonly userId: string;
  readonly check: () => void;
  readonly onCleanupFailure: () => void;
}): Promise<void> {
  const { request, response, native, check } = options;
  const original = request.url;
  const prefix = "/api/office/views/" + options.viewId + "/protocol";
  if (
    request.method !== "GET" ||
    !original?.startsWith(prefix + "/snapshot/") ||
    original.includes("?") ||
    original.endsWith("/fetchmissing")
  )
    throw new OfficeForbidden(safeFailure("FORBIDDEN"));
  const responseDone = finished(response, { cleanup: true }).then(
    (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
    (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
  );
  const releases: Array<() => Promise<void>> = [];
  let failure: unknown,
    failed = false,
    cleanupFailed = false;
  try {
    check();
    const database = createViewSnapshotDatabase(native, options.unit, options.userId, check);
    const service = new UniverCollabService({ dbAdapter: database, snapshotPolicy: false });
    releases.push(() => service.dispose());
    service.use("readUnitData", async (context, dispatch) => {
      check();
      if (
        context.userID !== options.userId ||
        context.request.unitID !== native.snapshot.unitID ||
        context.request.type !== native.snapshot.type
      )
        throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      await dispatch();
      check();
    });
    const endpoint = new UniverCollabEndpoint(service);
    releases.push(() => endpoint.dispose());
    const transport = createNodeTransport({ maxRequestBodyBytes: 1 });
    releases.push(() => transport.dispose());
    let complete: ((value: PromiseSettledResult<void>) => void) | undefined;
    const work = new Promise<PromiseSettledResult<void>>((resolve) => {
      complete = resolve;
    });
    transport.use((context, dispatch) => {
      const actual = Promise.resolve().then(() => {
        check();
        if (
          context.params.unitID !== native.snapshot.unitID ||
          context.params.type !== String(native.snapshot.type) ||
          (context.params.revision !== undefined &&
            context.params.revision !== String(native.snapshot.rev))
        )
          throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        context.userID = options.userId;
        return dispatch();
      });
      const observed = actual.then(
        (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
        (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
      );
      const settle = complete;
      if (settle === undefined) throw new Error("SDK snapshot work was not registered");
      void observed.then(settle);
      return actual;
    });
    let installed = 0;
    transport.register({
      register(router) {
        endpoint.register({
          get(path, handler) {
            if (routes.has(path)) {
              installed++;
              router.get(path, handler);
            }
          },
          // Registration is filtered; these routes are NOT installed and cannot report native success.
          post() {},
          delete() {},
          upgrade() {},
        });
      },
    });
    if (!installed) throw new Error("Actual SDK snapshot routes unavailable");
    request.url = "/universer-api" + original.slice(prefix.length);
    check();
    transport.handleRequest(request, response);
    const result = await work;
    const sent = await responseDone;
    if (result.status === "rejected") throw result.reason;
    if (sent.status === "rejected") throw sent.reason;
    check();
  } catch (cause) {
    failed = true;
    failure = cause;
  } finally {
    request.url = original;
    for (const release of releases.toReversed()) {
      try {
        await release();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) options.onCleanupFailure();
  if (failed) throw failure;
  if (cleanupFailed) throw new Error("Office snapshot serializer cleanup failed");
}
