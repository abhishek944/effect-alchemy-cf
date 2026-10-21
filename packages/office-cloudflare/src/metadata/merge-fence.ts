import type { WritePermit } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";
/** Retain the approved frozen draft through all native leaves; only this operation's main may advance. */
export function mergeFence(db: MetadataStore, permit: WritePermit): PredicateSQL {
  return {
    sql: `EXISTS(SELECT 1 FROM office_meta_barriers b JOIN office_meta_reviews r ON r.owner=b.owner AND r.id=json_extract(b.record,'$.reviewId')
    JOIN office_meta_drafts m ON m.owner=r.owner AND m.document=r.document AND m.worktree=json_extract(r.record,'$.worktreeId')
    JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
    WHERE b.owner=? AND b.document=? AND b.operation=? AND json_extract(b.record,'$.fingerprint')=? AND r.fingerprint=?
    AND (? IS NULL OR m.id=?) AND m.generation=json_extract(r.record,'$.generation') AND w.generation=m.generation AND w.status IN ('ready','merging','merged')
    AND d.head=json_extract(r.record,'$.draftRevision') AND d.ready=json_extract(r.record,'$.readyRevision')
    AND d.baseline IS json_extract(r.record,'$.baselineRevision') AND d.source=json_extract(r.record,'$.source') AND d.removed=json_extract(r.record,'$.removed'))`,
    values: [
      db.native(permit.owner, permit.documentId, permit.target.unitId),
      db.owner(permit.owner),
      permit.documentId,
      permit.operationId,
      permit.reviewFingerprint,
      permit.reviewFingerprint,
      permit.target.scope.kind === "draft" ? permit.target.scope.draftId : null,
      permit.target.scope.kind === "draft" ? permit.target.scope.draftId : null,
    ],
  };
}
