import { Schema } from "effect";
import { Digest, Id } from "@starter/office-contract";
import { NativeReceiptBinding, NativeReceiptKey } from "@starter/office-server/ports";
import type { ObserveNativeReceipt, NativeReceiptObservation } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "../store.ts";
import { MetadataStore, canonical, conflict, sqlNow, storeEffect } from "../store.ts";
import { Permit, NativeId } from "../schemas.ts";
import { operationRow } from "../operations.ts";
import { writeRow, preparedSlot, acceptedReceipt } from "../write-context.ts";
import { completeRefs } from "../artifacts.ts";
import { captureContext, requireContext, forbidden } from "./context.ts";
import { requireOriginalTarget } from "./original-target.ts";
import { originalScalar } from "./receipt-scalar.ts";
import type { VerifiedCoordinatorContext } from "./types.ts";

const Input = Schema.Struct({
  target: Permit.fields.target,
  operationId: Id,
  stepId: NativeId,
  writeId: Id,
  payloadDigest: Digest,
  receipt: NativeReceiptKey,
  expected: NativeReceiptBinding,
});
/** Concrete EXISTING receipt port; requires real ingress verification, grants no content or native handle. */
export function createNativeReceiptObserver(
  options: OfficeProviderOptions,
  verifiedContext: VerifiedCoordinatorContext,
): ObserveNativeReceipt {
  const db = new MetadataStore(options),
    context = captureContext(db, verifiedContext);
  return (input) =>
    storeEffect(async (): Promise<NativeReceiptObservation> => {
      const request = db.decode(Input, db.encode(Input, input));
      if (
        context.kind !== "core" ||
        context.binding.kind !== "operation" ||
        context.purpose === "metadata" ||
        context.binding.operationId !== request.operationId ||
        canonical(context.document) !==
          canonical({
            owner: request.target.owner,
            documentId: request.target.documentId,
            unitId: request.target.unitId,
          })
      )
        throw forbidden();
      await requireContext(db, context, context.document);
      const operation = await operationRow(db, request.target.owner, request.operationId);
      if (!operation) return { state: "unknown" };
      if (
        operation.intentDigest !== context.binding.intentDigest ||
        operation.lineageDigest !== context.binding.lineageDigest
      )
        throw forbidden();
      await requireOriginalTarget(db, operation, context.target);
      const write = await writeRow(db, request.target.owner, request.writeId);
      if (!write) return { state: "unknown" };
      if (
        write.id !== request.writeId ||
        write.operationId !== request.operationId ||
        write.stepId !== request.stepId ||
        write.documentId !== request.target.documentId ||
        write.unitId !== request.target.unitId ||
        write.payload.digest !== request.payloadDigest ||
        canonical(write.receiptKey) !== canonical(request.receipt)
      )
        throw conflict();
      if (write.worktreeId === null) {
        if (operation.intent.kind === "merge") {
          if (
            !["create-main", "main-change", "snapshot"].includes(write.receiptKey.kind) ||
            operation.worktreeId === null ||
            write.generation === null ||
            request.target.scope.kind !== "draft" ||
            request.target.scope.draftId !== operation.receipt.draftId ||
            request.target.scope.generation !== write.generation ||
            canonical(request.target) !== canonical(context.target)
          )
            throw forbidden();
          // Semantic trunk leaf, but authority remains the ORIGINAL draft-bound merge target.
          await requireOriginalTarget(db, operation, request.target);
        } else if (
          request.target.scope.kind !== "main" ||
          operation.worktreeId !== null ||
          write.generation !== null
        )
          throw forbidden();
      } else {
        if (
          request.target.scope.kind !== "draft" ||
          request.target.scope.generation !== write.generation ||
          request.target.scope.draftId !== operation.receipt.draftId ||
          write.worktreeId !== operation.worktreeId
        )
          throw forbidden();
        const identity = await db.first(
          "SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND worktree=?",
          [
            db.owner(operation.owner),
            request.target.scope.draftId,
            write.documentId,
            write.worktreeId,
          ],
        );
        if (!identity) throw conflict("CONTENT_REQUIRED"); // Identity only: deliberately NO current-generation predicate.
      }
      if (write.preparedReceipt === null) return { state: "unknown" };
      if (canonical(write.preparedReceipt) !== canonical(request.expected)) throw conflict();
      const slot = preparedSlot(db, request.target.owner, write, request.expected);
      const receipt = acceptedReceipt(db, request.target.owner, write, request.expected);
      const payload = completeRefs(db, request.target.owner, [write.payload]);
      const proven = await db.first(
        `SELECT 1 WHERE (${slot.sql}) AND (${receipt.sql}) AND (${payload.sql}) AND ?>${sqlNow}`,
        [...slot.values, ...receipt.values, ...payload.values, context.notAfter],
      );
      if (!proven) return { state: "unknown" };
      const scalar = await originalScalar(db, request.target.owner, write);
      await requireContext(db, context, context.document);
      return scalar.proven
        ? {
            state: "confirmed",
            fingerprint: request.expected.fingerprint,
            authorityEpoch: request.expected.authorityEpoch,
            acceptedRevision: scalar.revision,
          }
        : { state: "unknown" };
    });
}
