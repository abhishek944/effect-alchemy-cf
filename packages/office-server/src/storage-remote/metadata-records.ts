import { Schema } from "effect";
import { ArtifactRef, Count, Digest, Document, Failure, Id, View } from "@starter/office-contract";
import { OwnerClaims, NativeReceiptKey, NativeReceiptBinding } from "../ports/index.ts";
import { HostId, HostEpoch } from "./host-wire.ts";
// Schema-only intra-package reuse; these modules have no Node runtime imports.
export {
  StoredDocument as HostDocumentRecord,
  StoredDraft as HostDraftRecord,
  StoredView as HostViewRecord,
  StoredOperation as HostOperationRecord,
} from "../core/record-schemas.ts";
import { IsolatedJobSchema } from "../jobs/schemas.ts";
export const HostJobState = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["queued", "running"]), jobId: Id }),
  Schema.Struct({
    state: Schema.Literal("succeeded"),
    jobId: Id,
    inputDigest: Digest,
    output: ArtifactRef,
  }),
  Schema.Struct({
    state: Schema.Literals(["failed", "execution-unknown"]),
    jobId: Id,
    error: Failure,
  }),
]);
export const HostJobRecord = Schema.Struct({
  owner: OwnerClaims,
  job: IsolatedJobSchema,
  state: HostJobState,
  version: Count,
  dispatch: Schema.NullOr(Schema.Struct({ workerId: HostId, claimedAt: Count, deadlineAt: Count })),
  createdAt: Count,
  updatedAt: Count,
});
export const HostReviewRecord = Schema.Struct({
  owner: OwnerClaims,
  id: Id,
  documentId: Id,
  unitId: HostId,
  worktreeId: HostId,
  generation: Count,
  baselineRevision: Schema.NullOr(Count),
  draftRevision: Count,
  readyRevision: Count,
  mainRevision: Schema.NullOr(Count),
  source: Schema.Literals(["trunk", "worktree"]),
  removed: Schema.Boolean,
  destination: Schema.Struct({ documentId: Id, unitId: HostId, title: Document.fields.title }),
  main: Schema.NullOr(View),
  baseline: Schema.NullOr(View),
  draft: View,
  result: Schema.NullOr(View),
  preview: Schema.NullOr(ArtifactRef),
  fingerprint: Digest,
  sdkVersion: Schema.Literal("1.0.3"),
  policyVersion: HostId,
  state: Schema.Literals(["complete", "incomplete", "conflict"]),
  expiresAt: Count,
});
export const HostApprovalRecord = Schema.Struct({
  owner: OwnerClaims,
  operationId: Id,
  reviewId: Id,
  fingerprint: Digest,
  humanPrincipalId: HostId,
  sessionEpoch: Count,
  expiresAt: Count,
  consumedBy: Schema.NullOr(Id),
});
export const HostBarrierRecord = Schema.Struct({
  owner: OwnerClaims,
  documentId: Id,
  operationId: Id,
  approvalOperationId: Id,
  reviewId: Id,
  fingerprint: Digest,
  authorityEpoch: HostEpoch,
  state: Schema.Literals(["active", "attention"]),
});
export const HostWriteRecord = Schema.Struct({
  id: Id,
  operationId: Id,
  stepId: HostId,
  documentId: Id,
  unitId: HostId,
  worktreeId: Schema.NullOr(HostId),
  nativeType: Schema.Literals([1, 2, 3]),
  generation: Schema.NullOr(Count),
  baseRevision: Schema.NullOr(Count),
  sid: Schema.NullOr(HostId),
  reqId: Schema.NullOr(Count),
  kind: Schema.Literals(["create-unit", "changeset", "snapshot", "lifecycle"]),
  receiptKey: NativeReceiptKey,
  preparedReceipt: Schema.NullOr(NativeReceiptBinding),
  payload: ArtifactRef,
  phase: Schema.Literals(["staged", "dispatching", "unknown", "confirmed", "absent", "failed"]),
  acceptedRevision: Schema.NullOr(Count),
});
