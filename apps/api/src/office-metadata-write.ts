import { Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { HostMetadata } from "@starter/office-server/native-remote";
import type { OfficeMetadataResult } from "./office-metadata-dispatch.ts";

type WriteName =
  | "reserveDocument"
  | "publishDocument"
  | "reserveDraft"
  | "advanceGeneration"
  | "putView"
  | "changeEditor"
  | "reserveJob"
  | "advanceJob"
  | "reserveOperation"
  | "advanceOperation"
  | "claimQueued"
  | "putReview"
  | "approve"
  | "admitPublication"
  | "finishPublication"
  | "stageWrite"
  | "prepareWrite"
  | "confirmWrite";
type OfficeMetadataWriteCall = (typeof HostMetadata)[WriteName]["request"]["Type"];
/** Internal mapping: enter only through dispatchOfficeMetadata's original per-call authorization. */
export function writeOfficeMetadata(
  metadata: OfficeMetadata,
  call: OfficeMetadataWriteCall,
): Effect.Effect<OfficeMetadataResult, OfficeError> {
  return Effect.gen(function* () {
    switch (call.method) {
      case "metadata.reserveDocument":
        return { method: call.method, value: yield* metadata.reserveDocument(call.input.record) };
      case "metadata.publishDocument":
        return { method: call.method, value: yield* metadata.publishDocument(call.input.permit) };
      case "metadata.reserveDraft":
        return { method: call.method, value: yield* metadata.reserveDraft(call.input.record) };
      case "metadata.advanceGeneration":
        return {
          method: call.method,
          value: yield* metadata.advanceGeneration(
            call.input.permit,
            call.input.draftId,
            call.input.expected,
          ),
        };
      case "metadata.putView":
        return { method: call.method, value: yield* metadata.putView(call.input.record) };
      case "metadata.changeEditor":
        return {
          method: call.method,
          value: yield* metadata.changeEditor(
            call.input.owner,
            call.input.action,
            call.input.expectedEpoch,
            call.input.resolvedView,
          ),
        };
      case "metadata.reserveJob":
        return { method: call.method, value: yield* metadata.reserveJob(call.input.record) };
      case "metadata.advanceJob":
        return {
          method: call.method,
          value: yield* metadata.advanceJob(call.input.record, call.input.expectedVersion),
        };
      case "metadata.reserveOperation":
        return { method: call.method, value: yield* metadata.reserveOperation(call.input.record) };
      case "metadata.advanceOperation":
        return {
          method: call.method,
          value: yield* metadata.advanceOperation(call.input.record, call.input.expectedVersion),
        };
      case "metadata.claimQueued":
        return {
          method: call.method,
          value: yield* metadata.claimQueued(
            call.input.workerId,
            call.input.limit,
            call.input.until,
          ),
        };
      case "metadata.putReview":
        return { method: call.method, value: yield* metadata.putReview(call.input.review) };
      case "metadata.approve":
        return { method: call.method, value: yield* metadata.approve(call.input.approval) };
      case "metadata.admitPublication":
        return {
          method: call.method,
          value: yield* metadata.admitPublication(
            call.input.permit,
            call.input.operation,
            call.input.approvalOperationId,
            call.input.fingerprint,
          ),
        };
      case "metadata.finishPublication":
        yield* metadata.finishPublication(call.input.permit, call.input.receipt);
        return { method: call.method, value: null };
      case "metadata.stageWrite":
        return {
          method: call.method,
          value: yield* metadata.stageWrite(call.input.permit, call.input.write),
        };
      case "metadata.prepareWrite":
        return {
          method: call.method,
          value: yield* metadata.prepareWrite(
            call.input.permit,
            call.input.writeId,
            call.input.binding,
          ),
        };
      case "metadata.confirmWrite":
        yield* metadata.confirmWrite(
          call.input.permit,
          call.input.writeId,
          call.input.acceptedRevision,
        );
        return { method: call.method, value: null };
      default: {
        const exhaustive: never = call;
        return exhaustive;
      }
    }
  });
}
