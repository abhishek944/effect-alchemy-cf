import { DraftTarget, decodeWireSync } from "@starter/office-contract";
import type { OperationRecord } from "@starter/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

/** Correlation of a real stored actor to an already-proven current input, not authentication. */
export function sameOfficeTaskInput(proof: OfficeTaskProof, operation: OperationRecord): boolean {
  const { actor } = operation;
  const { session, acceptedInput: current } = proof.association;
  if (actor.capability !== "draft-task") return false;
  const original = actor.acceptedInput;
  return (
    actor.owner.stage === session.stage &&
    actor.owner.ownerId === session.ownerId &&
    officeSame(operation.owner, actor.owner) &&
    actor.principalId === session.ownerId &&
    actor.sessionEpoch === session.sessionEpoch &&
    original.requestId === current.requestId &&
    original.submissionId === current.submissionId &&
    original.conversationId === current.conversationId &&
    original.digest === current.digest
  );
}

/** Confirmed immutable descriptors only. Caller still verifies View/draft/origin/current native policy. */
export function confirmedOfficeTaskTargets(
  proof: OfficeTaskProof,
  operations: readonly OperationRecord[],
): readonly DraftTarget[] {
  if (operations.length > 128) throw officeDenied();
  const targets = new Map<string, DraftTarget>();
  const add = (input: DraftTarget) => {
    const target = Object.freeze(decodeWireSync(DraftTarget)(input));
    targets.set(
      JSON.stringify([
        target.documentId,
        target.draftId,
        target.generation,
        target.expectedRevision,
      ]),
      target,
    );
  };
  for (const operation of operations) {
    if (
      !sameOfficeTaskInput(proof, operation) ||
      operation.actor.capability !== "draft-task" ||
      operation.receipt.phase !== "confirmed" ||
      operation.receipt.kind !== operation.intent.kind ||
      operation.intent.kind === "approve" ||
      operation.intent.kind === "merge" ||
      operation.receipt.documentId !== operation.documentId
    )
      throw officeDenied();
    const { intent, receipt } = operation;
    const bound = operation.actor.target;
    if (bound !== null) {
      if (
        bound.documentId !== operation.documentId ||
        (!["render", "export"].includes(intent.kind) && receipt.draftId !== bound.draftId)
      )
        throw officeDenied();
      add(bound); // A confirmed original actor is a prior descriptor, not an extended old grant.
    }
    if (intent.kind === "create" || intent.kind === "create-draft") {
      if (
        (intent.kind === "create" && intent.input.destination !== "new-draft") ||
        receipt.draftId === null ||
        operation.worktreeId === null
      )
        throw officeDenied();
      let revision = receipt.acceptedRevision;
      if (intent.kind === "create-draft") {
        const captured = proof.association.target;
        if (
          captured?.kind !== "main" ||
          captured.documentId !== operation.documentId ||
          intent.input.documentId !== captured.documentId ||
          (revision !== null && revision !== captured.expectedRevision)
        )
          throw officeDenied();
        // Strict initial fork fence pins the SDK's copied trunk head; never read current head here.
        revision = captured.expectedRevision;
      }
      if (revision === null) throw officeDenied();
      add({
        documentId: operation.documentId,
        draftId: receipt.draftId,
        generation: 1,
        expectedRevision: revision,
      });
      continue;
    }
    if (intent.kind === "execute" || intent.kind === "import-into") {
      if (
        bound === null ||
        !officeSame(bound, intent.input.target) ||
        (receipt.acceptedRevision !== null && receipt.acceptedRevision < bound.expectedRevision)
      )
        throw officeDenied();
      add({ ...bound, expectedRevision: receipt.acceptedRevision ?? bound.expectedRevision });
    } else if (intent.kind === "ready" || intent.kind === "reopen" || intent.kind === "discard") {
      if (
        bound === null ||
        intent.input.draftId !== bound.draftId ||
        intent.input.generation !== bound.generation
      )
        throw officeDenied();
      if (intent.kind === "discard") continue;
      if (
        intent.kind === "ready"
          ? receipt.acceptedRevision !== null && receipt.acceptedRevision !== bound.expectedRevision
          : receipt.acceptedRevision !== null
      )
        throw officeDenied();
      add({ ...bound, generation: bound.generation + (intent.kind === "reopen" ? 1 : 0) });
    }
  }
  return Object.freeze([...targets.values()]);
}
