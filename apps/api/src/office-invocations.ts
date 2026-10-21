import type { Auth } from "@starter/auth";
import type { RuntimeContext } from "alchemy";
import {
  type OfficeSessionEpochs,
  revalidateOfficeSessionBinding,
  type OfficeSessionBinding,
} from "@starter/auth/office-session";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { OwnerClaims, type HumanActor, type OwnerScope } from "@starter/office-server/ports";
import { Clock, Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OfficeTaskProofReader } from "./office-task-callback.ts";
import { OfficeTaskSelector } from "./office-task-proof.ts";
import {
  prepareOfficeTask,
  revalidateOfficeTask,
  type OfficeTaskInvocation,
} from "./office-task-issuance.ts";

/** Server-private record: never return the session association to Node/browser/model. */
type HumanInvocation = {
  readonly actor: HumanActor;
  readonly session: OfficeSessionBinding;
  readonly deadline: number;
};
export type OfficeInvocation = HumanInvocation | OfficeTaskInvocation;
type Live<A> = Effect.Effect<A, OfficeError, Auth | OfficeSessionEpochs | RuntimeContext>;
type Registration = {
  readonly original: OfficeInvocation;
  phase: "unused" | "claimed" | "released";
  timer: ReturnType<typeof setTimeout> | undefined;
};
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));

/** Owned by the container DO, not a public session-ID authentication endpoint. */
export class OfficeInvocationRegistry {
  readonly #owner: OwnerScope;
  readonly #issued = new Map<string, Registration>();
  #issuing = 0;

  constructor(owner: OwnerScope) {
    this.#owner = Object.freeze(decodeWireSync(OwnerClaims)(structuredClone(owner)));
  }

  #live(session: OfficeSessionBinding): Live<void> {
    if (session.stage !== this.#owner.stage || session.ownerId !== this.#owner.ownerId)
      return Effect.fail(forbidden());
    return revalidateOfficeSessionBinding(this.#owner.stage, session).pipe(
      Effect.catchTag("OfficeSessionDenied", () => Effect.fail(forbidden())),
      Effect.catchTag("OfficeSessionUnavailable", () =>
        Effect.fail(new OfficeUnavailable(safeFailure("UNAVAILABLE"))),
      ),
    );
  }

  /** Owner exists BEFORE returning any ACK. Only this exact still-unused original may expire. */
  #retain(original: OfficeInvocation): void {
    const id = original.actor.invocationId;
    const entry: Registration = { original, phase: "unused", timer: undefined };
    const expire = () => {
      if (this.#issued.get(id) !== entry || entry.phase !== "unused") return;
      const remaining = original.deadline - Date.now();
      if (remaining > 0) {
        entry.timer = setTimeout(expire, remaining); // Same immutable deadline, never renewal.
        return;
      }
      entry.phase = "released"; // Fence future acquisition atomically BEFORE deletion.
      this.#issued.delete(id);
    };
    this.#issued.set(id, entry);
    try {
      entry.timer = setTimeout(expire, Math.max(0, original.deadline - Date.now()));
    } catch (error) {
      entry.phase = "released";
      this.#issued.delete(id);
      throw error;
    }
  }

  /** ONLY the authenticated Worker's private DO binding may register original51 metadata. */
  registerHuman(original: OfficeSessionBinding): Live<HumanInvocation> {
    const session = Object.freeze(structuredClone(original));
    return Effect.gen({ self: this }, function* () {
      yield* this.#live(session);
      const now = yield* Clock.currentTimeMillis;
      const deadline = Math.min(session.expiresAt, now + 120_000);
      if (deadline <= now) return yield* Effect.fail(forbidden());
      if (this.#issued.size + this.#issuing >= 128)
        return yield* Effect.fail(new OfficeUnavailable(safeFailure("BUSY")));
      const actor: HumanActor = Object.freeze({
        capability: "human",
        owner: this.#owner,
        principalId: session.ownerId,
        sessionEpoch: session.sessionEpoch,
        invocationId: crypto.randomUUID(),
        expiresAt: deadline,
      });
      const record = Object.freeze({ actor, session, deadline });
      this.#retain(record);
      return record;
    });
  }

  /** Actual Root event bindings only; own bounded slot through physical IO settlement. */
  registerTask(
    selector: OfficeTaskSelector,
    readProof: OfficeTaskProofReader,
    options: OfficeProviderOptions,
    observeOnly: boolean,
  ): Live<OfficeTaskInvocation> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        let input: OfficeTaskSelector;
        try {
          input = Object.freeze(decodeWireSync(OfficeTaskSelector)(selector));
        } catch {
          return Effect.fail(forbidden());
        }
        if (this.#issuing >= 4 || this.#issued.size + this.#issuing >= 128)
          return Effect.fail(new OfficeUnavailable(safeFailure("BUSY")));
        this.#issuing++; // Same synchronous step as the capacity check, before any await/yield.
        return prepareOfficeTask(
          this.#owner,
          input,
          readProof,
          options,
          (session) => this.#live(session),
          observeOnly,
        ).pipe(
          Effect.tap((original) => Effect.sync(() => this.#retain(original))),
          Effect.ensuring(
            Effect.sync(() => {
              this.#issuing--;
            }),
          ),
        );
      }),
    );
  }

  /** Private Root handoff ownership ONLY; binding/session association precedes selection.
   * Synchronous claim fences unused cleanup before any await. It is NOT authentication or a grant.
   */
  claim(invocationId: string): OfficeInvocation {
    const entry = this.#issued.get(invocationId);
    if (entry === undefined || entry.phase !== "unused" || entry.original.deadline <= Date.now())
      throw forbidden();
    entry.phase = "claimed";
    clearTimeout(entry.timer);
    entry.timer = undefined;
    return entry.original;
  }

  /** Caller proves original private association first; lookup neither authenticates nor consumes. */
  resolve(invocationId: string): Live<OfficeInvocation> {
    return Effect.gen({ self: this }, function* () {
      const entry = this.#issued.get(invocationId);
      if (
        entry === undefined ||
        entry.phase !== "claimed" ||
        entry.original.deadline <= (yield* Clock.currentTimeMillis)
      )
        return yield* Effect.fail(forbidden());
      const original = entry.original;
      yield* this.#live(original.session);
      if ("task" in original) yield* revalidateOfficeTask(original);
      if (
        this.#issued.get(invocationId) !== entry ||
        entry.phase !== "claimed" ||
        original.deadline <= (yield* Clock.currentTimeMillis)
      )
        return yield* Effect.fail(forbidden());
      return original;
    });
  }

  /** Logical exact-original release ONLY AFTER its claimed owner joins all actual work/cleanup. */
  release(original: OfficeInvocation): void {
    const id = original.actor.invocationId;
    const entry = this.#issued.get(id);
    if (entry?.original !== original || entry.phase !== "claimed") throw forbidden();
    entry.phase = "released";
    clearTimeout(entry.timer);
    this.#issued.delete(id);
  }
}
