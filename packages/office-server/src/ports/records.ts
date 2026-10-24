import { Schema } from "effect";
import { Digest, Id, Revision } from "@starter/office-contract";
import type {
  ArtifactRef,
  CreateDocument,
  CreateDraft,
  Document,
  DraftTransition,
  Execute,
  ImportInto,
  ExportRequest,
  Merge,
  Receipt,
  RenderRequest,
  Approve,
  View,
} from "@starter/office-contract";
import type { ActorClaims, NativeTarget, OwnerScope } from "./identity.ts";
import type { IsolatedJob, JobState } from "./jobs.ts";
import type { NativeReceiptBinding, NativeReceiptKey } from "./native-receipts.ts";

/** Durable opaque View binding; no native content or caller-supplied authority. */
export type ViewRecord = {
  readonly owner: OwnerScope;
  readonly view: View;
  readonly target: NativeTarget;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly source:
    | { readonly kind: "core"; readonly revision: number }
    | { readonly kind: "draft"; readonly worktreeId: string; readonly revision: number }
    | { readonly kind: "artifact"; readonly artifact: ArtifactRef };
};
/** Durable claim metadata only; native/code bytes remain immutable artifacts. */
export type JobRecord = {
  readonly owner: OwnerScope;
  readonly job: IsolatedJob;
  readonly state: JobState;
  readonly version: number;
  readonly dispatch: {
    readonly workerId: string;
    readonly claimedAt: number;
    readonly deadlineAt: number;
  } | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DocumentRecord = {
  readonly owner: OwnerScope;
  readonly document: Document;
  readonly unitId: string;
  readonly originOperationId: string;
  readonly location: "reserved-main" | "main" | "draft";
};
export type DraftRecord = {
  readonly owner: OwnerScope;
  readonly id: string;
  readonly documentId: string;
  readonly worktreeId: string;
  readonly generation: number;
  readonly originOperationId: string;
};
export type OperationIntent =
  | { readonly kind: "create"; readonly input: CreateDocument }
  | { readonly kind: "create-draft"; readonly input: CreateDraft }
  | { readonly kind: "execute"; readonly input: Execute }
  | { readonly kind: "import-into"; readonly input: ImportInto }
  | { readonly kind: "render"; readonly input: RenderRequest }
  | { readonly kind: "export"; readonly input: ExportRequest }
  | { readonly kind: "approve"; readonly input: Approve }
  | { readonly kind: "merge"; readonly input: Merge }
  | { readonly kind: "ready" | "reopen" | "discard"; readonly input: DraftTransition };
export type OperationArtifacts = {
  readonly source: ArtifactRef | null;
  readonly input: ArtifactRef | null;
  readonly code: ArtifactRef | null;
  readonly proposal: ArtifactRef | null;
};
/** Durable proof of completed semantic merge verification, owned by its operation record. */
export const MergeWitness = Schema.Struct({
  purpose: Schema.Literal("office-merge-verified"),
  version: Schema.Literal(1),
  operationId: Id,
  reviewId: Id,
  fingerprint: Digest,
  previewDigest: Digest,
  outcome: Schema.Literals(["merged", "unchanged"]),
  acceptedRevision: Schema.NullOr(Revision),
  native: Schema.Struct({
    unitID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    type: Schema.Literals([1, 2, 3]),
    rev: Revision,
  }),
  nativeDigest: Digest,
});
export type MergeWitness = typeof MergeWitness.Type;
export type OperationRecord = {
  readonly owner: OwnerScope;
  readonly actor: ActorClaims;
  readonly documentId: string;
  readonly unitId: string;
  readonly worktreeId: string | null;
  readonly intent: OperationIntent;
  readonly intentDigest: string;
  readonly lineageDigest: string;
  readonly receipt: Receipt;
  readonly artifacts: OperationArtifacts;
  /** Set once by completed semantic verification; never grants later native reads. */
  readonly merge: MergeWitness | null;
  readonly jobId: string | null;
  readonly policyVersion: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};
export type FrozenReview = {
  readonly owner: OwnerScope;
  readonly id: string;
  readonly documentId: string;
  readonly unitId: string;
  readonly worktreeId: string;
  readonly generation: number;
  readonly baselineRevision: number | null;
  readonly draftRevision: number;
  readonly readyRevision: number;
  readonly mainRevision: number | null;
  readonly source: "trunk" | "worktree";
  readonly removed: boolean;
  readonly destination: {
    readonly documentId: string;
    readonly unitId: string;
    readonly title: string;
  };
  readonly main: View | null;
  readonly baseline: View | null;
  readonly draft: View;
  readonly result: View | null;
  readonly preview: ArtifactRef | null;
  readonly fingerprint: string;
  readonly sdkVersion: "1.0.3";
  readonly policyVersion: string;
  readonly state: "complete" | "incomplete" | "conflict";
  readonly expiresAt: number;
};
export type ApprovalRecord = {
  readonly owner: OwnerScope;
  readonly operationId: string;
  readonly reviewId: string;
  readonly fingerprint: string;
  readonly humanPrincipalId: string;
  readonly sessionEpoch: number;
  readonly expiresAt: number;
  readonly consumedBy: string | null;
};
export type PublicationBarrier = {
  readonly owner: OwnerScope;
  readonly documentId: string;
  readonly operationId: string;
  readonly approvalOperationId: string;
  readonly reviewId: string;
  readonly fingerprint: string;
  readonly authorityEpoch: number;
  readonly state: "active" | "attention";
};
export type NativeWriteRecord = {
  readonly id: string;
  readonly operationId: string;
  /** Original admitted native step; distinct from this journal record ID. */
  readonly stepId: string;
  readonly documentId: string;
  readonly unitId: string;
  readonly worktreeId: string | null;
  readonly nativeType: number;
  readonly generation: number | null;
  readonly baseRevision: number | null;
  readonly sid: string | null;
  readonly reqId: number | null;
  readonly kind: "create-unit" | "changeset" | "snapshot" | "lifecycle";
  /** Persist the exact semantic provider receipt key before dispatch. */
  readonly receiptKey: NativeReceiptKey;
  /** Provider-prepared binding persisted before publication; null cannot confirm recovery. */
  readonly preparedReceipt: NativeReceiptBinding | null;
  readonly payload: ArtifactRef;
  readonly phase: "staged" | "dispatching" | "unknown" | "confirmed" | "absent" | "failed";
  readonly acceptedRevision: number | null;
};
