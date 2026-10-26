import { Schema } from "effect";
import { Count, Cursor, Digest, Id, Kind, Label, Revision, Title } from "./primitives.ts";
import { Failure } from "./errors.ts";

export const ArtifactKind = Schema.Literals([
  "upload",
  "code",
  "native-input",
  "native-proposal",
  "native-preview",
  "native-write",
  "export",
  "render",
  "inspection",
]);
export const ArtifactRef = Schema.Struct({
  id: Id,
  kind: ArtifactKind,
  digest: Digest,
  bytes: Count,
  mediaType: Schema.String.check(Schema.isPattern(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/)),
});
export type ArtifactRef = typeof ArtifactRef.Type;
export const Document = Schema.Struct({
  id: Id,
  kind: Kind,
  title: Title,
  revision: Schema.NullOr(Revision),
  draftId: Schema.NullOr(Id),
});
export type Document = typeof Document.Type;
export const DraftStatus = Schema.Literals(["draft", "ready", "merging", "merged", "discarded"]);
export const Draft = Schema.Struct({
  id: Id,
  documentId: Id,
  generation: Count,
  status: DraftStatus,
  reviewId: Schema.NullOr(Id),
  publication: Schema.Literals(["none", "pending", "complete", "attention"]),
});
export type Draft = typeof Draft.Type;
export const CommandKind = Schema.Literals([
  "create",
  "create-draft",
  "execute",
  "import-into",
  "ready",
  "approve",
  "merge",
  "reopen",
  "discard",
  "export",
  "render",
]);
export const OperationPhase = Schema.Literals([
  "reserved",
  "input-pinned",
  "queued",
  "running",
  "proposal-staged",
  "admitted",
  "dispatching",
  "submission-unknown",
  "publishing",
  "confirmed",
  "failed-before-submit",
  "execution-unknown",
  "conflict",
  "needs-attention",
  "cancelled-before-dispatch",
]);
export type OperationPhase = typeof OperationPhase.Type;
export const Receipt = Schema.Struct({
  operationId: Id,
  kind: CommandKind,
  phase: OperationPhase,
  version: Count,
  documentId: Schema.NullOr(Id),
  draftId: Schema.NullOr(Id),
  reviewId: Schema.NullOr(Id),
  artifact: Schema.NullOr(ArtifactRef),
  acceptedRevision: Schema.NullOr(Revision),
  error: Schema.NullOr(Failure),
});
export type Receipt = typeof Receipt.Type;
const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
/** Descriptive SDK identities only. Opaque view/session + fresh host auth grant access. */
export const NativeViewTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main"), unitId: NativeId }),
  Schema.Struct({
    kind: Schema.Literal("draft"),
    unitId: NativeId,
    worktreeId: NativeId,
    generation: Count,
  }),
  Schema.Struct({ kind: Schema.Literal("pinned-snapshot"), unitId: NativeId }),
]);
export type NativeViewTarget = typeof NativeViewTarget.Type;
export const View = Schema.Struct({
  id: Id,
  documentId: Id,
  kind: Kind,
  revision: Revision,
  nativeTarget: NativeViewTarget,
  mode: Schema.Literals(["edit", "read-only"]),
  protocolPrefix: Schema.String.check(
    Schema.isPattern(/^(?:\/universer-api|\/api\/office\/views\/[A-Za-z0-9_-]{16,96}\/protocol)$/),
  ),
  expiresAt: Count,
}).check(
  Schema.makeFilter((view) =>
    view.nativeTarget.kind === "pinned-snapshot"
      ? view.mode === "read-only" &&
        view.protocolPrefix === "/api/office/views/" + view.id + "/protocol"
      : view.protocolPrefix === "/universer-api",
  ),
);
export type View = typeof View.Type;
export const Editor = Schema.Struct({
  id: Id,
  epoch: Count,
  view: View,
  expiresAt: Count,
  state: Schema.Literals(["active", "draining", "drained", "unclean", "revoked"]),
});
export type Editor = typeof Editor.Type;
export const DocumentPage = Schema.Struct({
  items: Schema.Array(Document).check(Schema.isMaxLength(100)),
  next: Cursor,
});
export const DraftPage = Schema.Struct({
  items: Schema.Array(Draft).check(Schema.isMaxLength(100)),
  next: Cursor,
});
export const DocumentEvent = Schema.Struct({
  sequence: Count,
  documentId: Id,
  draftId: Schema.NullOr(Id),
  generation: Count,
  revision: Schema.NullOr(Revision),
  operationId: Schema.NullOr(Id),
  kind: Schema.Literals([
    "revision-confirmed",
    "draft-state",
    "operation-state",
    "editor-state",
    "authority-changed",
  ]),
});
export type DocumentEvent = typeof DocumentEvent.Type;
export const EventPage = Schema.Struct({
  items: Schema.Array(DocumentEvent).check(Schema.isMaxLength(100)),
  next: Cursor,
  gap: Schema.Boolean,
});
export const DownloadInfo = Schema.Struct({ artifact: ArtifactRef, filename: Label });
