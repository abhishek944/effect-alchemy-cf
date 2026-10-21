import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import { OfficeForbidden, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { OfficeControlChannel, OfficeControlSession } from "./native-channel.ts";
import type { OfficeBinaryChannel, OfficeBinarySession } from "./native-transfer-types.ts";
import { OfficeEditorPublication } from "./native-editor-publication.ts";

export type OfficeRequestChannels = {
  readonly work: OfficeControlChannel;
  readonly manifest: OfficeControlChannel;
  readonly cleanup: OfficeControlChannel;
  readonly binary: OfficeBinaryChannel;
};
type JsonRole = "work" | "manifest" | "cleanup";
type Lease = { readonly channels: OfficeRequestChannels; active: boolean };
const cleanupMethods = new Set(["editor.revoke", "editor.release", "turn.release", "native.close"]);
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));

/** Request-local resource association ONLY. T47 must authenticate before transferring channels here. */
export class OfficeRequestContext {
  private readonly local = new AsyncLocalStorage<Lease>();
  private failedCleanup = false;
  readonly publication = new OfficeEditorPublication();
  readonly work = this.dispatcher("work");
  readonly manifest = this.dispatcher("manifest");
  readonly cleanup = this.dispatcher("cleanup");
  readonly binary = this.binaryDispatcher();

  private binaryDispatcher(): OfficeBinarySession {
    const exchange: OfficeBinarySession["exchange"] = (definition, input, transfer) =>
      Effect.suspend(() => this.lease(true).channels.binary.exchange(definition, input, transfer));
    return Object.freeze({
      exchange,
      drain: () => Promise.resolve().then(() => this.lease(false).channels.binary.drain()),
    });
  }

  private lease(work: boolean): Lease {
    const lease = this.local.getStore();
    if (lease === undefined || (work && !lease.active)) throw forbidden();
    if (work && this.failedCleanup) throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
    return lease;
  }
  private channel(role: JsonRole, work: boolean): OfficeControlChannel {
    return this.lease(work).channels[role];
  }
  private dispatcher(role: JsonRole): OfficeControlSession {
    const call: OfficeControlSession["call"] = (definition, input, mutation) =>
      Effect.suspend(() => {
        if (role === "cleanup" && !cleanupMethods.has(definition.method))
          return Effect.fail(forbidden());
        this.lease(role !== "cleanup");
        const send = Effect.suspend(() =>
          this.channel(role, role !== "cleanup").call(definition, input, mutation),
        );
        return role === "manifest"
          ? this.publication.before(definition.method, input).pipe(Effect.andThen(send))
          : send;
      });
    return Object.freeze({
      call,
      drain: () => Promise.resolve().then(() => this.channel(role, false).drain()),
    });
  }
  /** Ownership transfer: caller must await the FULL response/message task, never void dispatch. */
  async run<A>(input: OfficeRequestChannels, body: () => Promise<A>): Promise<A> {
    const channels = Object.freeze({
      work: input.work,
      manifest: input.manifest,
      cleanup: input.cleanup,
      binary: input.binary,
    });
    const previous = this.local.getStore();
    if (previous?.active) {
      if (
        previous.channels.work !== channels.work ||
        previous.channels.manifest !== channels.manifest ||
        previous.channels.cleanup !== channels.cleanup ||
        previous.channels.binary !== channels.binary
      )
        throw forbidden();
      this.assertClean();
      return body(); // Nested SDK work uses the exact original binding, not another scope/turn.
    }
    const lease: Lease = { channels, active: true };
    const outcome = await this.local.run(lease, () =>
      Promise.resolve()
        .then(() => {
          this.assertClean();
          return body();
        })
        .then(
          (value): { readonly ok: true; readonly value: A } => ({ ok: true, value }),
          (error: unknown): { readonly ok: false; readonly error: unknown } => ({
            ok: false,
            error,
          }),
        ),
    );
    lease.active = false;
    // Attempt EVERY real work closer even if one rejects. Cleanup remains available until last.
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => channels.work.close()),
      Promise.resolve().then(() => channels.manifest.close()),
      Promise.resolve().then(() => channels.binary.close()),
    ]);
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => channels.cleanup.close()),
    ]);
    if ([...closed, ...cleanup].some((value) => value.status === "rejected"))
      this.failedCleanup = true;
    if (!outcome.ok) throw outcome.error; // Preserve the original denial, even if cleanup also failed.
    this.assertClean();
    return outcome.value;
  }
  /** Real local SDK/serializer disposal failure poisons later work and remains visible at shutdown. */
  failCleanup(): void {
    this.failedCleanup = true;
  }
  /** Server shutdown must check this after joining all actual request tasks. */
  assertClean(): void {
    if (this.failedCleanup) throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  }
}
