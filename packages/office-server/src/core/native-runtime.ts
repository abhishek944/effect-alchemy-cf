import { Clock, Effect } from "effect";
import { createNativeServices, type NativeServices } from "./native-services.ts";
import type { NativeAccess, NativeTarget, OfficeDependencies } from "../ports/index.ts";
import { NativeLeaseContext, type NativeJournal, type NativeLease } from "./native-lease.ts";
import { nativeCall, officeFailure } from "./failure.ts";

export type { NativeServices } from "./native-services.ts";
type Slot = NativeServices & {
  context: NativeLeaseContext;
  epoch: string;
  busy: number;
  used: number;
};
export class OfficeNativeRuntime {
  private readonly slots = new Map<string, Slot>();
  private closed = false;
  private readonly deps: OfficeDependencies;
  constructor(deps: OfficeDependencies) {
    this.deps = deps;
  }
  private async dispose(slot: Slot): Promise<void> {
    await slot.drafts.dispose();
    await slot.core.dispose();
  }
  private async slot(target: NativeTarget, epoch: string, now: number): Promise<Slot> {
    if (this.closed) throw officeFailure("UNAVAILABLE");
    const key = JSON.stringify([
      target.owner.stage,
      target.owner.ownerId,
      target.documentId,
      target.unitId,
    ]);
    for (const [id, cached] of this.slots) {
      if (!cached.busy && now - cached.used >= this.deps.policy.limits.cacheTtlSeconds * 1000) {
        this.slots.delete(id);
        await this.dispose(cached);
        return this.slot(target, epoch, now);
      }
    }
    const previous = this.slots.get(key);
    if (previous && previous.epoch === epoch) {
      previous.busy++;
      return previous;
    }
    if (previous) {
      if (previous.busy) throw officeFailure("AUTHORITY_LOST");
      this.slots.delete(key);
      await this.dispose(previous);
      return this.slot(target, epoch, now);
    }
    if (this.slots.size >= this.deps.policy.limits.cachedUnits) {
      const idle = [...this.slots.entries()]
        .filter(([, item]) => item.busy === 0)
        .toSorted((a, b) => a[1].used - b[1].used)[0];
      if (!idle) throw officeFailure("BUSY");
      this.slots.delete(idle[0]);
      await this.dispose(idle[1]);
      return this.slot(target, epoch, now);
    }
    const context = new NativeLeaseContext(target);
    const value = {
      context,
      ...createNativeServices(context, this.deps.policy.limits),
      epoch,
      busy: 1,
      used: now,
    };
    this.slots.set(key, value);
    return value;
  }
  /** Cache/resource ownership only, never a data grant. Protocol callbacks must still enter invoke(). */
  services(target: NativeTarget) {
    return Effect.gen({ self: this }, function* () {
      const state = yield* this.deps.authority.current(target.owner, target.documentId);
      const epoch = JSON.stringify([
        state.authorityEpoch,
        state.serviceEpoch,
        this.deps.policy.sdkVersion,
        this.deps.policy.version,
        this.deps.policy.imageDigest,
      ]);
      const now = yield* Clock.currentTimeMillis;
      const slot = yield* Effect.acquireRelease(
        nativeCall(() => this.slot(target, epoch, now)),
        (value) =>
          Effect.sync(() => {
            value.busy--;
            value.used = Date.now();
          }),
      );
      return { core: slot.core, drafts: slot.drafts };
    });
  }
  invoke<A>(
    access: NativeAccess,
    worktreeId: string | null,
    mode: NativeLease["mode"],
    journal: NativeJournal | null,
    call: (services: NativeServices) => Promise<A>,
  ) {
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const pair = yield* this.deps.native(access);
        const target = access.kind === "read" ? access.target : access.permit.target;
        if ((target.scope.kind === "draft") !== (worktreeId !== null))
          return yield* Effect.fail(officeFailure("INVALID_INPUT"));
        const state = access.kind === "read" ? access : access.permit;
        const epoch = JSON.stringify([
          state.authorityEpoch,
          state.serviceEpoch,
          this.deps.policy.sdkVersion,
          this.deps.policy.version,
          this.deps.policy.imageDigest,
        ]);
        const now = yield* Clock.currentTimeMillis;
        const slot = yield* Effect.acquireRelease(
          nativeCall(() => this.slot(target, epoch, now)),
          (value) =>
            Effect.sync(() => {
              value.busy--;
              value.used = Date.now();
            }),
        );
        const lease: NativeLease = {
          target,
          access,
          pair,
          mode,
          journal,
          worktreeId,
          active: true,
        };
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            lease.active = false;
          }),
        );
        return yield* nativeCall(() => slot.context.local.run(lease, () => call(slot)));
      }),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    const slots = [...this.slots.values()];
    this.slots.clear();
    for (const slot of slots) await this.dispose(slot);
  }
}
export const makeNativeRuntime = Effect.fn("Office.makeNativeRuntime")(function* (
  deps: OfficeDependencies,
) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => new OfficeNativeRuntime(deps)),
    (runtime) => nativeCall(() => runtime.close()).pipe(Effect.orDie),
  );
});
