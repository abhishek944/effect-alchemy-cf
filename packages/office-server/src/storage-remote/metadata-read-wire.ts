import { Schema } from "effect";
import { ArtifactRef, Count, Cursor, DocumentEvent, Editor, Id } from "@starter/office-contract";
import { OwnerClaims } from "../ports/index.ts";
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
import { HostId, HostTarget, hostMethod } from "./host-wire.ts";

const owner = { owner: OwnerClaims };
const document = Schema.Struct({ ...owner, documentId: Id });
function page<S extends Schema.Constraint>(item: S) {
  return Schema.Struct({ items: Schema.Array(item).check(Schema.isMaxLength(100)), next: Cursor });
}
export const HostMetadataReads = Object.freeze({
  document: hostMethod("metadata.document", document, Schema.NullOr(HostDocumentRecord)),
  documents: hostMethod(
    "metadata.documents",
    Schema.Struct({ ...owner, cursor: Cursor }),
    page(HostDocumentRecord),
  ),
  draft: hostMethod(
    "metadata.draft",
    Schema.Struct({ ...owner, draftId: Id }),
    Schema.NullOr(HostDraftRecord),
  ),
  drafts: hostMethod(
    "metadata.drafts",
    Schema.Struct({ ...owner, cursor: Cursor }),
    page(HostDraftRecord),
  ),
  view: hostMethod(
    "metadata.view",
    Schema.Struct({ ...owner, viewId: Id }),
    Schema.NullOr(HostViewRecord),
  ),
  historicalViewTarget: hostMethod(
    "metadata.historicalViewTarget",
    Schema.Struct({ ...owner, viewId: Id }),
    Schema.NullOr(HostTarget),
  ),
  editor: hostMethod(
    "metadata.editor",
    Schema.Struct({ ...owner, editorId: Id }),
    Schema.NullOr(Editor),
  ),
  editors: hostMethod(
    "metadata.editors",
    document,
    Schema.Array(Editor).check(Schema.isMaxLength(100)),
  ),
  job: hostMethod(
    "metadata.job",
    Schema.Struct({ ...owner, jobId: Id }),
    Schema.NullOr(HostJobRecord),
  ),
  operation: hostMethod(
    "metadata.operation",
    Schema.Struct({ ...owner, operationId: Id }),
    Schema.NullOr(HostOperationRecord),
  ),
  review: hostMethod(
    "metadata.review",
    Schema.Struct({ ...owner, reviewId: Id }),
    Schema.NullOr(HostReviewRecord),
  ),
  approval: hostMethod(
    "metadata.approval",
    Schema.Struct({ ...owner, operationId: Id }),
    Schema.NullOr(HostApprovalRecord),
  ),
  publicationBarrier: hostMethod(
    "metadata.publicationBarrier",
    document,
    Schema.NullOr(HostBarrierRecord),
  ),
  writes: hostMethod(
    "metadata.writes",
    Schema.Struct({ ...owner, operationId: Id, cursor: Cursor }),
    page(HostWriteRecord),
  ),
  events: hostMethod(
    "metadata.events",
    Schema.Struct({ ...owner, documentId: Id, after: Count }),
    page(DocumentEvent),
  ),
});
export const HostBytes = Object.freeze({
  put: hostMethod(
    "bytes.put",
    Schema.Struct({
      ...owner,
      id: Id,
      kind: ArtifactRef.fields.kind,
      mediaType: ArtifactRef.fields.mediaType,
      declaredBytes: Count,
      expectedDigest: Schema.NullOr(ArtifactRef.fields.digest),
    }),
    ArtifactRef,
  ),
  get: hostMethod("bytes.get", Schema.Struct({ ...owner, id: Id }), Schema.NullOr(ArtifactRef)),
  removeUnreachable: hostMethod(
    "bytes.removeUnreachable",
    Schema.Struct({
      ...owner,
      id: Id,
      notBefore: Count,
    }),
    Schema.Null,
  ),
});
/** Only a selector; actual transport is fixed and private, never this value as a URL. */
export const HostStreamAssociation = Schema.Struct({ invocationId: HostId, callId: Id });
