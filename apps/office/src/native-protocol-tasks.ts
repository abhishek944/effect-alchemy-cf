import type { IncomingMessage } from "node:http";
import type { NodeTransportConnection } from "@univerjs-pro/collaboration-transport-node";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { OfficeProtocolAuthority } from "@starter/office-server/native-protocol";

type HttpTask = {
  done: Promise<void>;
  settle: () => void;
  error: unknown;
  failed: boolean;
  entered: boolean;
};
/** Observe the real public SDK authority/next promises: handleRequest/handleUpgrade themselves return void. */
export class OfficeProtocolTasks {
  private readonly requests = new WeakMap<IncomingMessage, HttpTask>();
  private readonly pending = new Set<Promise<void>>();
  private readonly connections = new Map<
    NodeTransportConnection,
    { done: Promise<void>; settle: () => void }
  >();
  private stopped = false;
  private cleanupFailed = false;
  private connection(connection: NodeTransportConnection): void {
    if (this.connections.has(connection)) return;
    let settle: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    if (settle === undefined) throw new Error("SDK close completion was not registered");
    this.connections.set(connection, { done, settle });
  }
  private track(body: () => void | Promise<void>, cleanup = false): Promise<void> {
    const actual = Promise.resolve().then(() => {
      if (this.stopped && !cleanup) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      return body();
    });
    const observed = actual.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(observed);
    void observed.then(() => this.pending.delete(observed));
    return actual;
  }
  request(request: IncomingMessage) {
    if (this.requests.has(request)) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    let settle: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    if (settle === undefined) throw new Error("SDK task completion was not registered");
    const state: HttpTask = { done, settle, error: undefined, failed: false, entered: false };
    this.requests.set(request, state);
    return {
      async join(): Promise<void> {
        await state.done;
        if (state.failed) throw state.error;
      },
    };
  }
  wrap(authority: OfficeProtocolAuthority): OfficeProtocolAuthority {
    const http: OfficeProtocolAuthority["http"] = (context, route, next) => {
      const state = this.requests.get(context.incomingMessage);
      if (state === undefined || state.entered)
        return Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN")));
      state.entered = true;
      const actual = this.track(() => authority.http(context, route, next));
      void actual.then(
        () => state.settle(),
        (cause: unknown) => {
          state.failed = true;
          state.error = cause;
          state.settle();
        },
      );
      return actual;
    };
    const upgrade: OfficeProtocolAuthority["upgrade"] = (context, route, next) => {
      const state = this.requests.get(context.incomingMessage);
      if (state === undefined || state.entered)
        return Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN")));
      state.entered = true;
      const actual = this.track(() => authority.upgrade(context, route, next));
      void actual.then(
        () => state.settle(),
        (cause: unknown) => {
          state.failed = true;
          state.error = cause;
          state.settle();
        },
      );
      return actual;
    };
    return {
      http,
      upgrade,
      socket: (connection, route, next) => {
        this.connection(connection);
        return this.track(() => authority.socket(connection, route, next));
      },
      session: (session, worktreeId, unitId) =>
        this.track(() => authority.session(session, worktreeId, unitId)),
      closed: (connection) => {
        const finish = () => {
          this.connections.get(connection)?.settle();
          this.connections.delete(connection);
          return undefined;
        };
        const actual = this.track(() => authority.closed(connection), true);
        void actual.then(finish, () => {
          this.cleanupFailed = true;
          return finish();
        });
      },
    };
  }
  revoke(): void {
    this.stopped = true;
  }
  failCleanup(): void {
    this.cleanupFailed = true;
    this.revoke();
  }
  assertActive(): void {
    if (this.stopped) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
  }
  async drain(): Promise<void> {
    // Known SDK close continuations must arrive/settle even after the raw socket's close event.
    while (this.pending.size || this.connections.size)
      await Promise.all([
        ...this.pending,
        ...[...this.connections.values()].map((state) => state.done),
      ]);
    if (this.cleanupFailed) throw new Error("Office SDK connection cleanup failed");
  }
}
