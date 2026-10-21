import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { Schema } from "effect";
import { OfficeForbidden, decodeWireSync, safeFailure } from "@starter/office-contract";
import { HostId } from "@starter/office-server/native-remote";
import { NativePrivateResolution } from "./native-private-wire.ts";
import type { NativePrivateConnection } from "./native-private-connection.ts";
import { nativePrivateChannels } from "./native-private-channels.ts";
import type { OfficeRequestContext, OfficeRequestChannels } from "./native-request-context.ts";

export type NativePrivateInvocation = {
  readonly value: NativePrivateResolution;
  readonly channels: OfficeRequestChannels;
  readonly signal: AbortSignal;
};
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Actual request/callback association. Opaque SDK customData capsules are not serialized grants. */
export class NativePrivateInvocations {
  private readonly incoming = new WeakMap<IncomingMessage, NativePrivateInvocation>();
  private readonly capsules = new WeakMap<object, NativePrivateInvocation>();
  private readonly local = new AsyncLocalStorage<{
    readonly invocation: NativePrivateInvocation;
    active: boolean;
  }>();
  private readonly pending = new Set<Promise<void>>();
  private readonly active = new Map<string, NativePrivateInvocation>();
  readonly connection: NativePrivateConnection;
  readonly context: OfficeRequestContext;
  constructor(connection: NativePrivateConnection, context: OfficeRequestContext) {
    this.connection = connection;
    this.context = context;
  }
  own(actual: Promise<unknown>): void {
    const observed = actual.then(
      () => undefined,
      () => {
        this.context.failCleanup();
      },
    );
    this.pending.add(observed);
    void observed.then(() => this.pending.delete(observed));
  }
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
    const resources = [...this.active.values()].flatMap(({ channels }) => [
      channels.work,
      channels.manifest,
      channels.binary,
      channels.cleanup,
    ]);
    const closed = await Promise.allSettled(resources.map((resource) => resource.close()));
    if (closed.some((result) => result.status === "rejected")) this.context.failCleanup();
    this.active.clear();
    this.context.assertClean();
  }
  callback(invocationId: string): NativePrivateInvocation {
    const actual = this.active.get(invocationId);
    if (actual === undefined || actual.signal.aborted || Date.now() >= actual.value.deadline)
      throw forbidden();
    return actual;
  }
  forget(invocationId: string): void {
    this.active.delete(invocationId);
  }
  /** Denial after a late re-resolution: close ONLY transports this resolution created, never a live scope. */
  discard(actual: NativePrivateInvocation): void {
    if (this.active.get(actual.value.invocationId) === actual)
      this.active.delete(actual.value.invocationId);
    const { channels } = actual;
    this.own(
      Promise.allSettled([
        channels.work.close(),
        channels.manifest.close(),
        channels.binary.close(),
        channels.cleanup.close(),
      ]).then((closed) => {
        if (closed.some((result) => result.status === "rejected")) this.context.failCleanup();
        return undefined;
      }),
    );
  }
  reuse(invocationId: string): NativePrivateInvocation | undefined {
    const scope = this.local.getStore();
    return scope?.active && scope.invocation.value.invocationId === invocationId
      ? scope.invocation
      : undefined;
  }
  current() {
    const current = this.local.getStore();
    if (current === undefined || !current.active) throw forbidden();
    return current.invocation;
  }
  from(request: IncomingMessage) {
    const current = this.incoming.get(request);
    if (current === undefined) throw forbidden();
    return current;
  }
  capture(data: Record<string, unknown>, current: NativePrivateInvocation): void {
    const capsule = Object.freeze({});
    this.capsules.set(capsule, current);
    data.officeOriginal = capsule;
  }
  original(data: Readonly<Record<string, unknown>>) {
    const capsule = data.officeOriginal;
    const current =
      typeof capsule === "object" && capsule !== null ? this.capsules.get(capsule) : undefined;
    if (current === undefined) throw forbidden();
    return current;
  }
  async resolve(invocationId: string, signal: AbortSignal, deadline: number) {
    const value = await this.connection.json(
      `/private/${invocationId}/resolve`,
      {},
      NativePrivateResolution,
      signal,
      deadline,
    );
    if (
      value.invocationId !== invocationId ||
      value.deadline > value.actor.expiresAt ||
      Date.now() >= value.deadline ||
      value.cleanupDeadline < value.deadline
    )
      throw forbidden();
    const channels = nativePrivateChannels(this.connection, value, signal);
    if (!this.active.has(invocationId) && this.active.size >= 256) {
      const closed = await Promise.allSettled([
        channels.work.close(),
        channels.manifest.close(),
        channels.binary.close(),
        channels.cleanup.close(),
      ]);
      if (closed.some((result) => result.status === "rejected")) this.context.failCleanup();
      throw forbidden();
    }
    const actual = Object.freeze({ value, channels, signal });
    this.active.set(invocationId, actual);
    return actual;
  }
  private async finished(
    current: NativePrivateInvocation,
    kind: "http" | "upgrade",
  ): Promise<void> {
    let clean = true;
    try {
      this.context.assertClean();
    } catch {
      clean = false;
    }
    try {
      await this.connection.json(
        `/private/${current.value.invocationId}/finished`,
        { kind, clean },
        Schema.Null,
        new AbortController().signal,
        current.value.cleanupDeadline,
      );
    } catch (error) {
      this.context.failCleanup();
      throw error;
    }
  }
  async run<A>(
    request: IncomingMessage,
    signal: AbortSignal,
    body: () => Promise<A>,
    kind: "http" | "upgrade",
  ): Promise<A> {
    const selector = request.headers["x-office-invocation"];
    if (typeof selector !== "string") throw forbidden();
    const id = decodeWireSync(HostId)(selector);
    // Correlation header is checked by the actual outbound original-process binding BEFORE issuance.
    const current = await this.resolve(id, signal, Date.now() + 10_000);
    this.incoming.set(request, current);
    const scope = { invocation: current, active: true };
    try {
      return await this.local.run(scope, () =>
        this.context.run(current.channels, async () => {
          try {
            return await body();
          } finally {
            scope.active = false;
          }
        }),
      );
    } finally {
      this.incoming.delete(request);
      if (this.active.get(id) === current) this.active.delete(id);
      // AFTER actual request channel closers. Upgrade completion is NOT socket/member quiescence.
      await this.finished(current, kind);
    }
  }
}
