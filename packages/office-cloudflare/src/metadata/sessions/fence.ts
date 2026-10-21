import type { ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import { canonical, invalid, sqlNow } from "../store.ts";
import { completeRefs } from "../artifacts.ts";

export const nativeTypes = { doc: 1, sheet: 2, slide: 3 } as const;
export function validateView(record: ViewRecord): void {
  const { view, target, source } = record;
  if (
    canonical(record.owner) !== canonical(target.owner) ||
    target.documentId !== view.documentId ||
    target.unitId !== view.nativeTarget.unitId ||
    record.authorityEpoch < 1 ||
    record.serviceEpoch < 1 ||
    (source.kind !== "artifact" && source.revision !== view.revision) ||
    (view.mode === "read-only") !== (view.nativeTarget.kind === "pinned-snapshot")
  )
    throw invalid();
  if (target.scope.kind === "main") {
    if (source.kind === "draft" || view.nativeTarget.kind === "draft") throw invalid();
  } else {
    if (target.scope.generation < 1 || source.kind === "core") throw invalid();
    if (view.nativeTarget.kind === "main") throw invalid();
    if (
      view.nativeTarget.kind === "draft" &&
      (source.kind !== "draft" ||
        view.nativeTarget.worktreeId !== source.worktreeId ||
        view.nativeTarget.generation !== target.scope.generation)
    )
      throw invalid();
  }
  if (
    source.kind === "artifact" &&
    (view.mode !== "read-only" ||
      !["native-preview", "native-input"].includes(source.artifact.kind))
  )
    throw invalid();
}
export function viewSQL(db: MetadataStore, record: ViewRecord, exact: boolean): PredicateSQL {
  validateView(record);
  const { view, target, source } = record,
    owner = db.owner(record.owner);
  const scope = db.native(record.owner, view.documentId, target.unitId);
  const clauses = [
    `?>${sqlNow}`,
    "EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=?)",
    "EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=? AND json_extract(record,'$.document.kind')=?)",
  ];
  const values: (string | number | null)[] = [
    view.expiresAt,
    scope,
    record.authorityEpoch,
    owner,
    view.documentId,
    target.unitId,
    view.kind,
  ];
  // Artifact revision belongs to its verified immutable header, not the published branch head.
  const nativeRevision = source.kind !== "artifact",
    comparison = exact ? "=" : ">=";
  if (target.scope.kind === "main") {
    clauses.push(`EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND lifecycle='active' AND type=?${nativeRevision ? ` AND head${comparison}?` : ""})
      AND EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND json_extract(record,'$.location')='main')`);
    values.push(
      scope,
      nativeTypes[view.kind],
      ...(nativeRevision ? [view.revision] : []),
      owner,
      view.documentId,
    );
  } else {
    clauses.push(`EXISTS(SELECT 1 FROM office_meta_drafts m JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
      JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id WHERE m.owner=? AND m.id=? AND m.document=?
      AND m.generation=? AND w.generation=? AND w.status${view.mode === "edit" ? "='draft'" : "<>'discarded'"}
      AND d.removed=0 AND d.type=?${nativeRevision ? ` AND d.head${comparison}?` : ""}${source.kind === "draft" ? " AND m.worktree=?" : ""})`);
    values.push(
      scope,
      owner,
      target.scope.draftId,
      view.documentId,
      target.scope.generation,
      target.scope.generation,
      nativeTypes[view.kind],
      ...(nativeRevision ? [view.revision] : []),
      ...(source.kind === "draft" ? [source.worktreeId] : []),
    );
  }
  if (source.kind === "artifact") {
    const ready = completeRefs(db, record.owner, [source.artifact]);
    clauses.push(ready.sql);
    values.push(...ready.values);
  }
  return { sql: clauses.join(" AND "), values };
}
export const viewIdentity = (record: ViewRecord) => ({
  ...record,
  view: { ...record.view, expiresAt: 0 },
});
export const viewBranch = (record: ViewRecord): string =>
  canonical(
    record.target.scope.kind === "main" ? ["main"] : ["draft", record.target.scope.draftId],
  );
