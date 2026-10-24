import { Effect, Schema } from "effect";
import {
  Approve,
  ArtifactRef,
  Count,
  CreateDocument,
  CreateDraft,
  Digest,
  Document,
  DocumentScope,
  View,
  DraftTransition,
  Execute,
  ImportInto,
  ExportRequest,
  Id,
  Merge,
  Receipt,
  Revision,
  RenderRequest,
} from "@starter/office-contract";
import { MergeWitness, OriginalActorClaims, OwnerClaims } from "../ports/index.ts";
const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const StoredDocument = Schema.Struct({
  owner: OwnerClaims,
  document: Document,
  unitId: NativeId,
  originOperationId: Id,
  location: Schema.Literals(["reserved-main", "main", "draft"]),
});
export const StoredDraft = Schema.Struct({
  owner: OwnerClaims,
  id: Id,
  documentId: Id,
  worktreeId: NativeId,
  generation: Count,
  originOperationId: Id,
});
export const Intent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create"), input: CreateDocument }),
  Schema.Struct({ kind: Schema.Literal("create-draft"), input: CreateDraft }),
  Schema.Struct({ kind: Schema.Literal("execute"), input: Execute }),
  Schema.Struct({ kind: Schema.Literal("import-into"), input: ImportInto }),
  Schema.Struct({ kind: Schema.Literal("render"), input: RenderRequest }),
  Schema.Struct({ kind: Schema.Literal("export"), input: ExportRequest }),
  Schema.Struct({ kind: Schema.Literal("approve"), input: Approve }),
  Schema.Struct({ kind: Schema.Literal("merge"), input: Merge }),
  Schema.Struct({ kind: Schema.Literals(["ready", "reopen", "discard"]), input: DraftTransition }),
]);
export const StoredArtifact = Schema.Struct({
  ...ArtifactRef.fields,
  mediaType: ArtifactRef.fields.mediaType.check(Schema.isMaxLength(128)),
});
export const StoredView = Schema.Struct({
  owner: OwnerClaims,
  view: View,
  target: Schema.Struct({
    owner: OwnerClaims,
    documentId: Id,
    unitId: NativeId,
    scope: DocumentScope,
  }),
  authorityEpoch: Count.check(Schema.isGreaterThanOrEqualTo(1)),
  serviceEpoch: Count.check(Schema.isGreaterThanOrEqualTo(1)),
  source: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("core"), revision: Revision }),
    Schema.Struct({ kind: Schema.Literal("draft"), worktreeId: NativeId, revision: Revision }),
    Schema.Struct({ kind: Schema.Literal("artifact"), artifact: StoredArtifact }),
  ]),
});
export const StoredOperation = Schema.Struct({
  owner: OwnerClaims,
  actor: OriginalActorClaims,
  documentId: Id,
  unitId: NativeId,
  worktreeId: Schema.NullOr(NativeId),
  intent: Intent,
  intentDigest: Digest,
  lineageDigest: Digest,
  receipt: Schema.Struct({ ...Receipt.fields, artifact: Schema.NullOr(StoredArtifact) }),
  artifacts: Schema.Struct({
    source: Schema.NullOr(StoredArtifact),
    input: Schema.NullOr(StoredArtifact),
    code: Schema.NullOr(StoredArtifact),
    proposal: Schema.NullOr(StoredArtifact),
  }),
  // Records persisted before the witness moved into the operation decode as "no witness yet".
  merge: Schema.NullOr(MergeWitness).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  jobId: Schema.NullOr(Id),
  policyVersion: NativeId,
  createdAt: Count,
  updatedAt: Count,
});
