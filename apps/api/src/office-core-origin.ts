import { Effect } from "effect";
import type { VerifiedCoordinatorContext } from "@starter/office-cloudflare/coordinator-control";
import type { ActorVerification, NativeTarget, OfficeMetadata } from "@starter/office-server/ports";
import { mergeOperationTuple } from "@starter/office-server/native-remote";
import {
  officeDenied,
  officeSame,
  officePrivateAuthority,
  type OfficePrivateRequest,
} from "./office-private-authority.ts";
import type { OfficePrivateTurns } from "./office-private-turns.ts";

type Binding = Extract<VerifiedCoordinatorContext, { kind: "core" }>["binding"];
/** Actual immutable operation OR original current human approval, before constructing Core context. */
export async function officeCoreOrigin(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  target: NativeTarget,
  operationId: string,
  purpose: "native" | "metadata" | "proof",
): Promise<{
  readonly binding: Binding;
  readonly notAfter: number;
  readonly basis: readonly unknown[];
}> {
  await request.live();
  const actor = request.original.actor;
  if (!officeSame(target.owner, actor.owner)) throw officeDenied();
  const operation = await Effect.runPromise(metadata.operation(target.owner, operationId));
  if (operation !== null) {
    if (
      operation.actor.principalId !== actor.principalId ||
      (purpose === "native" && !officeSame(operation.actor, actor)) ||
      operation.documentId !== target.documentId ||
      operation.unitId !== target.unitId
    )
      throw officeDenied();
    return {
      binding: {
        kind: "operation",
        operationId,
        intentDigest: operation.intentDigest,
        lineageDigest: operation.lineageDigest,
      },
      notAfter:
        purpose === "native"
          ? Math.min(request.original.deadline, operation.actor.expiresAt)
          : request.original.deadline,
      basis: [operation.intentDigest, operation.lineageDigest],
    };
  }
  const command = request.command;
  if (
    actor.capability !== "human" ||
    purpose !== "native" ||
    command?.method !== "office.merge" ||
    command.input.operationId !== operationId ||
    target.scope.kind !== "draft"
  )
    throw officeDenied();
  const approval = await Effect.runPromise(
    metadata.approval(target.owner, command.input.approvalOperationId),
  );
  if (
    approval === null ||
    approval.consumedBy !== null ||
    approval.expiresAt <= Date.now() ||
    approval.humanPrincipalId !== actor.principalId ||
    approval.sessionEpoch !== actor.sessionEpoch
  )
    throw officeDenied();
  const review = await Effect.runPromise(metadata.review(target.owner, approval.reviewId));
  const draft = await Effect.runPromise(metadata.draft(target.owner, target.scope.draftId));
  if (
    review === null ||
    draft === null ||
    review.state !== "complete" ||
    review.expiresAt <= Date.now() ||
    review.fingerprint !== approval.fingerprint ||
    review.documentId !== target.documentId ||
    review.unitId !== target.unitId ||
    review.generation !== target.scope.generation ||
    draft.generation !== target.scope.generation ||
    draft.worktreeId !== review.worktreeId
  )
    throw officeDenied();
  await request.live();
  return {
    binding: {
      kind: "new-merge",
      operationId,
      approvalOperationId: approval.operationId,
      principalId: actor.principalId,
      sessionEpoch: actor.sessionEpoch,
      reviewFingerprint: review.fingerprint,
    },
    notAfter: Math.min(request.original.deadline, approval.expiresAt, review.expiresAt),
    basis: [approval.operationId, review.fingerprint],
  };
}

/** Core verifies the FIRST admitted merge before the provider atomically inserts its operation. */
export async function verifyOfficeActorPhase(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  turns: OfficePrivateTurns,
  input: ActorVerification,
  policyVersion: string,
): Promise<void> {
  await request.live();
  const command = request.command;
  if (
    input.phase !== "final-commit" ||
    command?.method !== "office.merge" ||
    (await Effect.runPromise(
      metadata.operation(request.original.actor.owner, input.operationId),
    )) !== null
  ) {
    await Effect.runPromise(officePrivateAuthority(metadata, request).verify(input));
    return;
  }
  const actor = request.original.actor;
  const held = turns.provisional(input.operationId);
  if (
    actor.capability !== "human" ||
    !officeSame(input.claims, actor) ||
    command.input.operationId !== input.operationId ||
    input.target.scope.kind !== "draft" ||
    !officeSame(held.permit.target, input.target) ||
    held.context.kind !== "core" ||
    held.context.binding.kind !== "new-merge" ||
    held.context.binding.approvalOperationId !== command.input.approvalOperationId
  )
    throw officeDenied();
  const origin = await officeCoreOrigin(
    metadata,
    request,
    input.target,
    input.operationId,
    "native",
  );
  if (origin.binding.kind !== "new-merge" || !officeSame(origin.binding, held.context.binding))
    throw officeDenied();
  const approval = await Effect.runPromise(
    metadata.approval(actor.owner, command.input.approvalOperationId),
  );
  const review =
    approval === null
      ? null
      : await Effect.runPromise(metadata.review(actor.owner, approval.reviewId));
  const draft = await Effect.runPromise(metadata.draft(actor.owner, input.target.scope.draftId));
  if (
    review === null ||
    draft === null ||
    review.worktreeId !== draft.worktreeId ||
    review.generation !== input.target.scope.generation ||
    draft.generation !== review.generation ||
    review.fingerprint !== held.context.binding.reviewFingerprint ||
    review.draftRevision !== held.permit.expectedHead ||
    held.permit.reviewFingerprint !== review.fingerprint
  )
    throw officeDenied();
  // Exact persisted merge identity, shared with Core. The digest correlates the genuine held origin only.
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      mergeOperationTuple(
        input.operationId,
        command.input.approvalOperationId,
        input.target,
        draft.worktreeId,
        policyVersion,
      ),
    ),
  );
  if (bytes.byteLength > 16 * 1024) throw officeDenied();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (input.intentDigest !== digest || turns.provisional(input.operationId) !== held)
    throw officeDenied();
  await request.live();
}
