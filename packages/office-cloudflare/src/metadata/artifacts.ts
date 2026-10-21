import type { ArtifactRef } from "@starter/office-contract";
import type { OwnerScope, OperationRecord, FrozenReview } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { canonical } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";

export function operationRefs(record: OperationRecord): readonly ArtifactRef[] {
  return [
    ...Object.values(record.artifacts).filter((ref) => ref !== null),
    ...(record.receipt.artifact ? [record.receipt.artifact] : []),
  ];
}
export function reviewRefs(record: FrozenReview): readonly ArtifactRef[] {
  return record.preview ? [record.preview] : [];
}
export function completeRefs(
  db: MetadataStore,
  owner: OwnerScope,
  refs: readonly ArtifactRef[],
): PredicateSQL {
  return {
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(
    SELECT 1 FROM office_bytes_refs b WHERE b.owner=? AND b.id=json_extract(r.value,'$.id')
    AND b.state='ready' AND b.record=r.value))`,
    values: [canonical(refs), db.owner(owner)],
  };
}
export function artifactEdges(
  db: MetadataStore,
  owner: OwnerScope,
  source: string,
  sourceId: string,
  refs: readonly ArtifactRef[],
): Statement[] {
  return refs.map((ref) => [
    "INSERT OR IGNORE INTO office_meta_artifact_edges VALUES(?,?,?,?)",
    [db.owner(owner), source, sourceId, ref.id],
  ]);
}
