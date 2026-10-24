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
import { officeCaught, officeSame } from "./office-private-authority.ts";
import {
  officeDeny,
  officeReportBranch,
  type OfficeDiagnosticMetadata,
} from "./office-diagnostic-report.ts";
import { assertOfficeTaskReceipt } from "./office-task-command.ts";
import { freezeImageRequestValue } from "./chat-image-request-values.ts";
import { initializeOfficeStorageSchema } from "./office-storage-schema.ts";
import { readOfficeTaskAttachment } from "./office-task-attachment.ts";

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
  metadata: OfficeDiagnosticMetadata,
): OfficeTaskLive<OfficeTaskInvocation> {
  const read = () =>
    Effect.tryPromise({ try: () => readProof(owner, selector), catch: officeCaught });
  return Effect.gen(function* () {
    const proof = yield* read();
    const base = {
      ...metadata,
      operation: "prepare-task",
      operationId: proof.association.intent.operationId,
      taskId: proof.association.acceptedInput.toolTaskId,
      callId: proof.association.callId,
    };
    const deny = (reason: string) => officeDeny({ ...base, reason });
    /** Fixed failing step so a fault keeps its branch label and the original association. */
    const step = <A, R2>(reason: string, effect: Effect.Effect<A, OfficeError, R2>) =>
      effect.pipe(
        Effect.tapError((error: OfficeError) =>
          Effect.sync(() => officeReportBranch(error, { ...base, reason })),
        ),
      );
    const session = proof.association.session;
    yield* step("session-check", live(session));
    if (
      options.stage !== owner.stage ||
      session.stage !== owner.stage ||
      session.ownerId !== owner.ownerId
    )
      return yield* Effect.fail(deny("owner-stage-mismatch"));
    yield* step(
      "storage-schema",
      Effect.tryPromise({
        try: () => initializeOfficeStorageSchema(options.database),
        catch: officeCaught,
      }),
    );
    const metadataStore = createOfficeMetadata(options);
    const attachment = yield* step(
      "attachment-read",
      Effect.tryPromise({
        try: () => readOfficeTaskAttachment(metadataStore, proof, observeOnly),
        catch: officeCaught,
      }),
    );
    const selected = yield* Effect.gen(function* () {
      if (observeOnly) {
        const command = proof.association.intent.command;
        const operationId =
          command.command === "operation"
            ? command.operationId
            : proof.association.intent.operationId;
        yield* step(
          "receipt-proof",
          Effect.try({
            try: () =>
              assertOfficeTaskReceipt(proof, { method: "office.receipt", input: { operationId } }),
            catch: officeCaught,
          }),
        );
        return Object.freeze({ target: null, fork: null, readView: null });
      }
      const operations = yield* step(
        "operations-read",
        readConfirmedTaskOperations(options, {
          owner,
          principalId: session.ownerId,
          sessionEpoch: session.sessionEpoch,
          acceptedInput: proof.association.acceptedInput,
        }),
      );
      return yield* step(
        "target-resolve",
        Effect.tryPromise({
          try: () => resolveOfficeTaskTarget(metadataStore, proof, operations, attachment),
          catch: officeCaught,
        }),
      );
    });
    const binding = Object.freeze({ ...selected, attachment });
    const current = yield* step("proof-reread", read());
    if (!officeSame(current, proof)) return yield* Effect.fail(deny("proof-changed"));
    yield* step("session-recheck", live(session));
    const now = yield* Clock.currentTimeMillis;
    const deadline = proof.lease.notAfter;
    if (deadline <= now || deadline > session.expiresAt)
      return yield* Effect.fail(deny("lease-deadline-invalid"));
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
  const proof = original.task.proof;
  const base = {
    operation: "revalidate-task",
    operationId: proof.association.intent.operationId,
    taskId: proof.association.acceptedInput.toolTaskId,
    callId: proof.association.callId,
  };
  return Effect.tryPromise({
    try: async () => {
      const current = await original.task.readProof(original.actor.owner, original.task.selector);
      if (original.deadline <= Date.now()) throw officeDeny({ ...base, reason: "lease-expired" });
      if (!officeSame(current, original.task.proof))
        throw officeDeny({ ...base, reason: "proof-changed" });
    },
    catch: officeCaught,
  }).pipe(Effect.uninterruptible);
}
