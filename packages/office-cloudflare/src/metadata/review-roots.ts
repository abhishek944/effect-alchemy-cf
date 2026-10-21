import type { ArtifactRef } from "@starter/office-contract";
import type { FrozenReview, ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";
import { canonical, conflict, missing } from "./store.ts";
import { ViewRow } from "./sessions/schemas.ts";
import { validateView, viewSQL } from "./sessions/fence.ts";
type Role = "main" | "baseline" | "draft" | "result";
function roleMatches(role: Role, record: ViewRecord, review: FrozenReview): boolean {
  const { target, source, view } = record;
  if (role === "main" || role === "baseline") {
    const revision = role === "main" ? review.mainRevision : review.baselineRevision;
    return target.scope.kind === "main" && source.kind !== "draft" && view.revision === revision;
  }
  if (target.scope.kind !== "draft" || target.scope.generation !== review.generation) return false;
  if (role === "draft")
    return (
      view.revision === review.draftRevision &&
      (source.kind === "artifact" ||
        (source.kind === "draft" &&
          source.worktreeId === review.worktreeId &&
          source.revision === review.draftRevision))
    );
  // Artifact snapshots are separate from the sealed preview bundle; equal SDK
  // result/draft content may intentionally reuse the exact draft View identity.
  return (
    source.kind === "artifact" ||
    (view.id === review.draft.id &&
      source.kind === "draft" &&
      source.worktreeId === review.worktreeId &&
      source.revision === review.draftRevision)
  );
}
/** A review roots its durable opaque Views and every immutable artifact source, not just its preview. */
export async function reviewRoots(
  db: MetadataStore,
  review: FrozenReview,
): Promise<{ refs: readonly ArtifactRef[]; fence: PredicateSQL }> {
  const refs: ArtifactRef[] = review.preview ? [review.preview] : [],
    clauses: string[] = [],
    values: (string | number | null)[] = [],
    persisted: (readonly [string, string, string])[] = [];
  const roles = [
    ["main", review.main],
    ["baseline", review.baseline],
    ["draft", review.draft],
    ["result", review.result],
  ] as const;
  for (const [role, view] of roles) {
    if (!view) continue;
    const row = await db.first<{ record: string }>(
      "SELECT record FROM office_meta_views WHERE owner=? AND id=?",
      [db.owner(review.owner), view.id],
    );
    if (!row) throw missing();
    const record = db.decode(ViewRow, row.record);
    validateView(record);
    if (
      !roleMatches(role, record, review) ||
      canonical(record.owner) !== canonical(review.owner) ||
      record.target.unitId !== review.unitId ||
      record.target.documentId !== review.documentId ||
      canonical({ ...record.view, expiresAt: view.expiresAt }) !== canonical(view) ||
      record.view.expiresAt < review.expiresAt
    )
      throw conflict("STALE_REVIEW");
    if (record.target.scope.kind === "draft") {
      clauses.push(
        "EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND worktree=? AND generation=?)",
      );
      values.push(
        db.owner(review.owner),
        record.target.scope.draftId,
        review.documentId,
        review.worktreeId,
        review.generation,
      );
    }
    if (record.source.kind === "artifact") refs.push(record.source.artifact);
    const native = viewSQL(db, record, false);
    clauses.push(`(${native.sql})`);
    values.push(...native.values);
    persisted.push([db.owner(review.owner), view.id, row.record]);
  }
  // Four exact immutable View rows share one bounded metadata parameter, not
  // twelve repeated bindings. Native/source/READY/role predicates stay intact.
  clauses.push(`NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM office_meta_views v
    WHERE v.owner=json_extract(e.value,'$[0]') AND v.id=json_extract(e.value,'$[1]') AND v.record=json_extract(e.value,'$[2]')))`);
  values.push(canonical(persisted));
  return { refs, fence: { sql: clauses.join(" AND "), values } };
}
