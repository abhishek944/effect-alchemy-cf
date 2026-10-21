import { finished } from "node:stream/promises";
import { Effect } from "effect";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { HostNativeAccess } from "@starter/office-server/native-remote";
import { decodeWireSync } from "@starter/office-contract";
import type { OfficeNativeRuntime } from "@starter/office-server";
import type { NativeAccess } from "@starter/office-server/ports";
import type { OfficeProtocolAuthority } from "@starter/office-server/native-protocol";
import type { OfficeRequestChannels } from "./native-request-context.ts";
import type { OfficeRequestContext } from "./native-request-context.ts";

export type OfficeProtocolInvocation = {
  readonly channels: OfficeRequestChannels;
  /** HTTP View helpers require null; raw SDK snapshots require the genuine original read. */
  readonly access: Extract<NativeAccess, { kind: "read" }> | null;
  readonly worktreeId: string | null;
  readonly userId: string;
  readonly deadline: number;
  readonly signal: AbortSignal;
};
/** REAL T47 issuer dependency: session/Origin/View/member/process/epoch checks, not header/schema trust. */
export type OfficeProtocolIssuer = {
  http(
    context: Parameters<OfficeProtocolAuthority["http"]>[0],
    route: Parameters<OfficeProtocolAuthority["http"]>[1],
  ): Promise<OfficeProtocolInvocation>;
  upgrade(
    context: Parameters<OfficeProtocolAuthority["upgrade"]>[0],
    route: Parameters<OfficeProtocolAuthority["upgrade"]>[1],
  ): Promise<OfficeProtocolInvocation>;
  socket(
    connection: Parameters<OfficeProtocolAuthority["socket"]>[0],
    route: Parameters<OfficeProtocolAuthority["socket"]>[1],
  ): Promise<OfficeProtocolInvocation>;
  session: OfficeProtocolAuthority["session"];
  closed: OfficeProtocolAuthority["closed"];
};
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Node SDK scope adaptation. No native write turn is acquired or retained around callbacks. */
export function createOfficeProtocolAuthority(options: {
  readonly context: OfficeRequestContext;
  readonly runtime: OfficeNativeRuntime;
  readonly issuer: OfficeProtocolIssuer;
}): OfficeProtocolAuthority {
  async function invoke(
    invocation: OfficeProtocolInvocation,
    dispatch: () => void | Promise<void>,
    viewScoped: boolean,
  ) {
    return options.context.run(invocation.channels, async () => {
      const check = () => {
        if (
          !(invocation.signal instanceof AbortSignal) ||
          invocation.signal.aborted ||
          !Number.isSafeInteger(invocation.deadline) ||
          Date.now() >= invocation.deadline
        )
          throw denied();
      };
      check();
      if (viewScoped && invocation.access !== null) throw denied();
      const access =
        invocation.access === null
          ? null
          : decodeWireSync(HostNativeAccess)(structuredClone(invocation.access));
      if (
        access !== null &&
        (access.kind !== "read" ||
          access.target.owner.ownerId !== invocation.userId ||
          (access.target.scope.kind === "draft") !== (invocation.worktreeId !== null))
      )
        throw denied();
      let actual: Promise<PromiseSettledResult<void>> | undefined;
      const body = () => {
        const pending = Promise.resolve().then(check).then(dispatch).then(check);
        actual = pending.then(
          (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
          (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
        );
        return pending;
      };
      try {
        if (access === null) await body();
        else if (access.kind === "read")
          await Effect.runPromise(
            options.runtime.invoke(access, invocation.worktreeId, "read", null, body),
          );
        else throw denied();
      } finally {
        // Scope/Effect completion alone never certifies actual SDK next() settlement.
        if (actual !== undefined) await actual;
      }
    });
  }
  return {
    async http(context, route, next) {
      const viewScoped = route.params.viewID !== undefined;
      const response = finished(context.response, { cleanup: true }).then(
        (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
        (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
      );
      const invocation = await options.issuer.http(context, route);
      const stop = () => {
        if (!context.response.writableFinished) context.response.destroy();
      };
      invocation.signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(
        stop,
        Math.min(Math.max(0, invocation.deadline - Date.now()), 2147483647),
      );
      timer.unref();
      try {
        context.userID = invocation.userId; // Supplied by the genuine issuer, never request headers.
        await invoke(
          invocation,
          async () => {
            try {
              if (!viewScoped && route.template.includes("snapshot/") && invocation.access === null)
                throw denied();
              await next();
            } catch (cause) {
              if (!context.response.writableEnded && !context.response.destroyed) {
                if (context.response.headersSent) context.response.destroy();
                else
                  context.response.writeHead(403, { "cache-control": "private, no-store" }).end();
              }
              await response;
              throw cause;
            }
            const result = await response;
            if (result.status === "rejected") throw result.reason;
          },
          viewScoped,
        );
      } finally {
        clearTimeout(timer);
        invocation.signal.removeEventListener("abort", stop);
      }
    },
    async upgrade(context, route, next) {
      const invocation = await options.issuer.upgrade(context, route);
      await invoke(invocation, next, false);
    },
    async socket(connection, route, next) {
      const invocation = await options.issuer.socket(connection, route);
      await invoke(invocation, next, false);
    },
    session: (session, worktreeId, unitId) => options.issuer.session(session, worktreeId, unitId),
    closed: (connection) => options.issuer.closed(connection),
  };
}
