import type { Auth } from "@starter/auth";
import type { OfficeSessionBinding, OfficeSessionEpochs } from "@starter/auth/office-session";
import type { RuntimeContext } from "alchemy";
import { Clock, Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import {
  createOfficeMetadata,
  readConfirmedTaskOperations,
} from "@starter/office-cloudflare/metadata";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OwnerScope, TaskActor } from "@starter/office-server/ports";
import type { OfficeTaskProofReader } from "./office-task-callback.ts";
import {
  officeTaskSourceFile,
  type OfficeTaskProof,
  type OfficeTaskSelector,
} from "./office-task-proof.ts";
import { resolveOfficeTaskTarget, type OfficeTaskTarget } from "./office-task-target.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { assertOfficeTaskReceipt } from "./office-task-command.ts";
import { freezeImageRequestValue } from "./chat-image-request-values.ts";
import { initializeOfficeStorageSchema } from "./office-storage-schema.ts";

export type OfficeTaskLive<A> = Effect.Effect<
  A,
  OfficeError,
  Auth | OfficeSessionEpochs | RuntimeContext
>;
export type OfficeTaskInvocation = {
  readonly actor: TaskActor;
  readonly session: OfficeSessionBinding;
  readonly deadline: number;
  /** Root private only: never serialize this association/closure to Node/browser/model. */
  readonly task: {
    readonly selector: OfficeTaskSelector;
    readonly observeOnly: boolean;
    readonly proof: OfficeTaskProof;
    readonly binding: OfficeTaskTarget;
    readonly readProof: OfficeTaskProofReader;
  };
};

/** Issued only by actual Root private binding after original callback AND fresh51, not IDs/schema. */
export function prepareOfficeTask(
  owner: OwnerScope,
  selector: OfficeTaskSelector,
  readProof: OfficeTaskProofReader,
  options: OfficeProviderOptions,
  live: (session: OfficeSessionBinding) => OfficeTaskLive<void>,
  observeOnly: boolean,
): OfficeTaskLive<OfficeTaskInvocation> {
  const read = () =>
    Effect.tryPromise({ try: () => readProof(owner, selector), catch: officeDenied });
  return Effect.gen(function* () {
    const proof = yield* read();
    const session = proof.association.session;
    yield* live(session);
    if (
      options.stage !== owner.stage ||
      session.stage !== owner.stage ||
      session.ownerId !== owner.ownerId
    )
      return yield* Effect.fail(officeDenied());
    yield* Effect.tryPromise({
      try: () => initializeOfficeStorageSchema(options.database),
      catch: officeDenied,
    });
    const binding = yield* Effect.gen(function* () {
      if (observeOnly) {
        const command = proof.association.intent.command;
        const operationId =
          command.command === "operation"
            ? command.operationId
            : proof.association.intent.operationId;
        yield* Effect.try({
          try: () =>
            assertOfficeTaskReceipt(proof, { method: "office.receipt", input: { operationId } }),
          catch: officeDenied,
        });
        return Object.freeze({ target: null, fork: null, readView: null });
      }
      const metadata = createOfficeMetadata(options);
      const operations = yield* readConfirmedTaskOperations(options, {
        owner,
        principalId: session.ownerId,
        sessionEpoch: session.sessionEpoch,
        acceptedInput: proof.association.acceptedInput,
      });
      return yield* Effect.tryPromise({
        try: () => resolveOfficeTaskTarget(metadata, proof, operations),
        catch: officeDenied,
      });
    });
    const current = yield* read();
    if (!officeSame(current, proof)) return yield* Effect.fail(officeDenied());
    yield* live(session);
    const now = yield* Clock.currentTimeMillis;
    const deadline = proof.lease.notAfter;
    if (deadline <= now || deadline > session.expiresAt) return yield* Effect.fail(officeDenied());
    const sourceFile = officeTaskSourceFile(proof);
    const actor: TaskActor = {
      capability: "draft-task",
      owner,
      principalId: session.ownerId,
      sessionEpoch: session.sessionEpoch,
      invocationId: crypto.randomUUID(),
      expiresAt: deadline,
      target: binding.target,
      ...(sourceFile === undefined ? {} : { sourceFile }),
      acceptedInput: proof.association.acceptedInput,
    };
    return freezeImageRequestValue(
      { actor, session, deadline, task: { selector, proof, binding, readProof, observeOnly } },
      true,
    );
  });
}

/** Actual namespace read joins original immutable native association. Old actor expiry never renews. */
export function revalidateOfficeTask(
  original: OfficeTaskInvocation,
): Effect.Effect<void, OfficeError> {
  return Effect.tryPromise({
    try: async () => {
      const current = await original.task.readProof(original.actor.owner, original.task.selector);
      if (!officeSame(current, original.task.proof) || original.deadline <= Date.now())
        throw officeDenied();
    },
    catch: officeDenied,
  }).pipe(Effect.uninterruptible);
}
