import { Schema } from "effect";
import { Count, Digest, Editor, EditorAction, Id, Receipt } from "@starter/office-contract";
import { NativeReceiptBinding, OwnerClaims } from "../ports/index.ts";
import {
  HostDocumentRecord,
  HostDraftRecord,
  HostViewRecord,
  HostOperationRecord,
  HostJobRecord,
  HostReviewRecord,
  HostApprovalRecord,
  HostBarrierRecord,
  HostWriteRecord,
} from "./metadata-records.ts";
import { HostId, HostPermit, hostMethod } from "./host-wire.ts";

export const HostMetadataWrites = Object.freeze({
  reserveDocument: hostMethod(
    "metadata.reserveDocument",
    Schema.Struct({ record: HostDocumentRecord }),
    HostDocumentRecord,
  ),
  publishDocument: hostMethod(
    "metadata.publishDocument",
    Schema.Struct({ permit: HostPermit }),
    HostDocumentRecord,
  ),
  reserveDraft: hostMethod(
    "metadata.reserveDraft",
    Schema.Struct({ record: HostDraftRecord }),
    HostDraftRecord,
  ),
  advanceGeneration: hostMethod(
    "metadata.advanceGeneration",
    Schema.Struct({
      permit: HostPermit,
      draftId: Id,
      expected: Count,
    }),
    HostDraftRecord,
  ),
  putView: hostMethod(
    "metadata.putView",
    Schema.Struct({ record: HostViewRecord }),
    HostViewRecord,
  ),
  changeEditor: hostMethod(
    "metadata.changeEditor",
    Schema.Struct({
      owner: OwnerClaims,
      action: EditorAction,
      expectedEpoch: Schema.NullOr(Count),
      resolvedView: Schema.NullOr(HostViewRecord),
    }),
    Editor,
  ),
  reserveJob: hostMethod(
    "metadata.reserveJob",
    Schema.Struct({ record: HostJobRecord }),
    HostJobRecord,
  ),
  advanceJob: hostMethod(
    "metadata.advanceJob",
    Schema.Struct({
      record: HostJobRecord,
      expectedVersion: Count,
    }),
    HostJobRecord,
  ),
  reserveOperation: hostMethod(
    "metadata.reserveOperation",
    Schema.Struct({ record: HostOperationRecord }),
    HostOperationRecord,
  ),
  advanceOperation: hostMethod(
    "metadata.advanceOperation",
    Schema.Struct({
      record: HostOperationRecord,
      expectedVersion: Count,
    }),
    HostOperationRecord,
  ),
  claimQueued: hostMethod(
    "metadata.claimQueued",
    Schema.Struct({
      workerId: HostId,
      limit: Count.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
      until: Count,
    }),
    Schema.Array(HostOperationRecord).check(Schema.isMaxLength(100)),
  ),
  putReview: hostMethod(
    "metadata.putReview",
    Schema.Struct({ review: HostReviewRecord }),
    HostReviewRecord,
  ),
  approve: hostMethod(
    "metadata.approve",
    Schema.Struct({ approval: HostApprovalRecord }),
    HostApprovalRecord,
  ),
  admitPublication: hostMethod(
    "metadata.admitPublication",
    Schema.Struct({
      permit: HostPermit,
      operation: HostOperationRecord,
      approvalOperationId: Id,
      fingerprint: Digest,
    }),
    HostBarrierRecord,
  ),
  finishPublication: hostMethod(
    "metadata.finishPublication",
    Schema.Struct({
      permit: HostPermit,
      receipt: Receipt,
    }),
    Schema.Null,
  ),
  stageWrite: hostMethod(
    "metadata.stageWrite",
    Schema.Struct({
      permit: HostPermit,
      write: HostWriteRecord,
    }),
    HostWriteRecord,
  ),
  prepareWrite: hostMethod(
    "metadata.prepareWrite",
    Schema.Struct({
      permit: HostPermit,
      writeId: Id,
      binding: NativeReceiptBinding,
    }),
    HostWriteRecord,
  ),
  confirmWrite: hostMethod(
    "metadata.confirmWrite",
    Schema.Struct({
      permit: HostPermit,
      writeId: Id,
      acceptedRevision: Schema.NullOr(Count),
    }),
    Schema.Null,
  ),
});
