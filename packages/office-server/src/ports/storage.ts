import type { Effect } from "effect";
import type {
  ArtifactRef,
  DocumentEvent,
  Editor,
  EditorAction,
  OfficeError,
  Receipt,
} from "@starter/office-contract";
import type { NativeTarget, OwnerScope, WritePermit } from "./identity.ts";
import type { NativeReceiptBinding } from "./native-receipts.ts";
import type {
  ApprovalRecord,
  DocumentRecord,
  DraftRecord,
  FrozenReview,
  JobRecord,
  ViewRecord,
  NativeWriteRecord,
  OperationRecord,
  PublicationBarrier,
} from "./records.ts";

export type Store<A> = Effect.Effect<A, OfficeError>;
export type Page<A> = { readonly items: readonly A[]; readonly next: string | null };
/** One transactional metadata bundle. No arbitrary JSON/SQL/callback transaction escape hatch. */
export interface OfficeMetadata {
  document(owner: OwnerScope, documentId: string): Store<DocumentRecord | null>;
  documents(owner: OwnerScope, cursor: string | null): Store<Page<DocumentRecord>>;
  reserveDocument(record: DocumentRecord): Store<DocumentRecord>;
  publishDocument(permit: WritePermit): Store<DocumentRecord>;
  draft(owner: OwnerScope, draftId: string): Store<DraftRecord | null>;
  drafts(owner: OwnerScope, cursor: string | null): Store<Page<DraftRecord>>;
  reserveDraft(record: DraftRecord): Store<DraftRecord>;
  advanceGeneration(permit: WritePermit, draftId: string, expected: number): Store<DraftRecord>;
  /** Identity is immutable; only validated monotonic expiry renewal may change a View. */
  putView(record: ViewRecord): Store<ViewRecord>;
  view(owner: OwnerScope, viewId: string): Store<ViewRecord | null>;
  /** Immutable historical identity only. Never a live View, native/R2 read grant or expiry renewal. */
  historicalViewTarget(owner: OwnerScope, viewId: string): Store<NativeTarget | null>;
  editor(owner: OwnerScope, editorId: string): Store<Editor | null>;
  editors(owner: OwnerScope, documentId: string): Store<readonly Editor[]>;
  changeEditor(
    owner: OwnerScope,
    action: EditorAction,
    expectedEpoch: number | null,
    /** Required for acquire/renew; persist atomically with the lease. Null otherwise. */
    resolvedView: ViewRecord | null,
  ): Store<Editor>;
  /** Idempotent immutable job identity; only queued version zero may be newly reserved. */
  reserveJob(record: JobRecord): Store<JobRecord>;
  job(owner: OwnerScope, jobId: string): Store<JobRecord | null>;
  /** CAS queued -> claimed running before dispatch; terminal/identity changes are denied. */
  advanceJob(record: JobRecord, expectedVersion: number): Store<JobRecord>;
  reserveOperation(record: OperationRecord): Store<OperationRecord>;
  operation(owner: OwnerScope, operationId: string): Store<OperationRecord | null>;
  advanceOperation(record: OperationRecord, expectedVersion: number): Store<OperationRecord>;
  claimQueued(workerId: string, limit: number, until: number): Store<readonly OperationRecord[]>;
  putReview(review: FrozenReview): Store<FrozenReview>;
  review(owner: OwnerScope, reviewId: string): Store<FrozenReview | null>;
  approve(approval: ApprovalRecord): Store<ApprovalRecord>;
  approval(owner: OwnerScope, operationId: string): Store<ApprovalRecord | null>;
  /** Atomically consume approval + reserve merge operation + install document barrier. */
  admitPublication(
    permit: WritePermit,
    operation: OperationRecord,
    approvalOperationId: string,
    fingerprint: string,
  ): Store<PublicationBarrier>;
  publicationBarrier(owner: OwnerScope, documentId: string): Store<PublicationBarrier | null>;
  finishPublication(permit: WritePermit, receipt: Receipt): Store<void>;
  /** Stage payload identity before native dispatch; preserve terminal accepted writes. */
  stageWrite(permit: WritePermit, write: NativeWriteRecord): Store<NativeWriteRecord>;
  /**
   * Before native publication: bind provider fingerprint/original permit epoch once.
   * CAS the immutable journal/payload and unique operation/step/semantic receipt slot.
   * A different journal/payload in that slot conflicts; terminal binding cannot change.
   */
  prepareWrite(
    permit: WritePermit,
    writeId: string,
    binding: NativeReceiptBinding,
  ): Store<NativeWriteRecord>;
  writes(
    owner: OwnerScope,
    operationId: string,
    cursor: string | null,
  ): Store<Page<NativeWriteRecord>>;
  /** Null is valid only for a lifecycle step that has no accepted content revision. */
  confirmWrite(permit: WritePermit, writeId: string, acceptedRevision: number | null): Store<void>;
  events(owner: OwnerScope, documentId: string, after: number): Store<Page<DocumentEvent>>;
}
export interface OfficeBytes {
  /** Immutable bytes complete/digest-verified before a ref may be published in metadata. */
  put(
    owner: OwnerScope,
    input: {
      readonly id: string;
      readonly kind: ArtifactRef["kind"];
      readonly mediaType: string;
      readonly declaredBytes: number;
      readonly expectedDigest: string | null;
      readonly body: ReadableStream<Uint8Array>;
    },
  ): Store<ArtifactRef>;
  get(
    owner: OwnerScope,
    id: string,
  ): Store<{
    readonly ref: ArtifactRef;
    readonly body: ReadableStream<Uint8Array>;
  } | null>;
  /** Concrete implementation verifies durable unreachability and grace-period expiry. */
  removeUnreachable(owner: OwnerScope, id: string, notBefore: number): Store<void>;
}
