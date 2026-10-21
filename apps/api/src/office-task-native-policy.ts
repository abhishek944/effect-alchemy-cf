import { Effect } from "effect";
import type { NativeFence } from "@starter/office-cloudflare/native";
import type { NativeTarget, OfficeMetadata, SerialAdmission } from "@starter/office-server/ports";
import type { OfficeHeldTurn } from "./office-private-turns.ts";
import type { OfficeEditorHeld } from "./office-editor-grants.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { officeTaskActorPolicy } from "./office-task-actor-policy.ts";

/** Additional Task restriction only; existing real placement/coordinator/prep/FINAL still required. */
export async function assertOfficeTaskSerial(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  target: NativeTarget,
  admission: SerialAdmission,
) {
  const original = request.original;
  if (!("task" in original)) return null;
  await request.live();
  if (admission.reviewFingerprint !== null) throw officeDenied();
  const operation = await Effect.runPromise(
    metadata.operation(original.actor.owner, admission.operationId),
  );
  if (operation === null) throw officeDenied();
  await Effect.runPromise(
    officeTaskActorPolicy(
      metadata,
      request,
      original,
    )({
      claims: operation.actor,
      phase:
        admission.purpose === "proof" || request.command?.method === "office.receipt"
          ? "recovery-observe"
          : "final-commit",
      operationId: admission.operationId,
      intentDigest: operation.intentDigest,
      target,
    }),
  );
  if (admission.purpose === "proof" || request.command?.method === "office.receipt") {
    if (admission.purpose === "native") throw officeDenied();
    return operation; // Observation does not produce any native writer grant.
  }
  if (!officeSame(operation.actor, original.actor)) throw officeDenied();
  const creation = operation.intent.kind === "create" || operation.intent.kind === "create-draft";
  if (creation) {
    if (
      target.scope.kind !== "draft" ||
      target.scope.generation !== 1 ||
      target.scope.draftId !== operation.receipt.draftId ||
      admission.expectedHead !== null
    )
      throw officeDenied();
  } else {
    const bound = original.actor.target;
    const readOnly = operation.intent.kind === "render" || operation.intent.kind === "export";
    if (readOnly) {
      if (admission.purpose === "native") throw officeDenied();
    } else if (
      bound === null ||
      target.scope.kind !== "draft" ||
      bound.documentId !== target.documentId ||
      bound.draftId !== target.scope.draftId ||
      bound.generation !== target.scope.generation ||
      admission.expectedHead !== bound.expectedRevision
    )
      throw officeDenied();
  }
  await request.live();
  return operation;
}

/** Verify the ACTUAL provider basis, not a fence/epoch/header sent by the model or Node. */
export async function assertOfficeTaskBasis(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  held: OfficeHeldTurn | OfficeEditorHeld,
  fence: NativeFence,
): Promise<void> {
  const original = request.original;
  if (!("task" in original)) return;
  if (held.kind !== "core") throw officeDenied();
  const permit = held.permit;
  const operation = await assertOfficeTaskSerial(metadata, request, permit.target, {
    operationId: permit.operationId,
    expectedHead: permit.expectedHead,
    reviewFingerprint: permit.reviewFingerprint,
    purpose: "native",
  });
  if (
    operation === null ||
    fence.epoch !== permit.authorityEpoch ||
    fence.commandID !== permit.operationId ||
    fence.stepID !== permit.stepId ||
    permit.target.scope.kind !== "draft" ||
    fence.draft === undefined ||
    fence.draft.generation !== permit.target.scope.generation ||
    fence.draft.worktreeID !== operation.worktreeId
  )
    throw officeDenied();
  const creation = operation.intent.kind === "create" || operation.intent.kind === "create-draft";
  if (creation) {
    if (
      permit.expectedHead !== null ||
      fence.draft.status !== "draft" ||
      fence.draft.head !== 0 ||
      fence.draft.generation !== 1 ||
      held.turn.nativePlan === null ||
      !["fresh", "newborn-unit"].includes(held.turn.nativePlan)
    )
      throw officeDenied();
    if (operation.intent.kind === "create-draft") {
      const fork = original.task.binding.fork;
      if (
        fork === null ||
        fork.view.documentId !== operation.documentId ||
        fork.target.unitId !== operation.unitId ||
        fork.source.kind !== "core" ||
        fence.main === null ||
        fence.main.lifecycle !== "active" ||
        fence.main.head !== fork.view.revision ||
        fork.source.revision !== fork.view.revision
      )
        throw officeDenied();
    } else if (fence.main !== null) throw officeDenied();
  } else if (
    original.actor.target === null ||
    fence.draft.head !== original.actor.target.expectedRevision
  )
    throw officeDenied();
  // Do NOT constrain main to an old baseline for ordinary edits/Ready. Existing FINAL still fences it.
  await request.live();
}
