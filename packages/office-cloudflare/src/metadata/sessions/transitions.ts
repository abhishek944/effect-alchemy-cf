import type { Editor, EditorAction } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { conflict, sqlNow } from "../store.ts";
import { clock, leaseRow, observed } from "./leases.ts";
import { readView } from "./views.ts";
import { viewSQL } from "./fence.ts";
import { leaseUpdate } from "./editors.ts";
import { leaseEvent } from "./events.ts";

export async function closeEditor(
  db: MetadataStore,
  owner: OwnerScope,
  action: Extract<EditorAction, { kind: "drained" | "revoke" }>,
  expected: number,
): Promise<Editor> {
  const previous = await leaseRow(db, owner, action.editorId);
  if (!previous) throw conflict("NOT_FOUND");
  const old = previous.lease.editor,
    key = db.owner(owner);
  if (old.epoch !== expected) throw conflict("STALE_BASIS");
  if (action.kind === "revoke" && old.state === "revoked") return old;
  if (action.kind === "drained" && old.state === "drained") {
    if (previous.lease.confirmedRevision !== action.confirmedRevision)
      throw conflict("STALE_BASIS");
    return old;
  }
  if (old.state === "drained" || old.state === "revoked") throw conflict("NOT_EDITABLE");
  let sql = "1";
  const values: (string | number | null)[] = [];
  let confirmed: number | null = null;
  const editor: Editor = {
    ...old,
    state: action.kind === "revoke" ? "revoked" : "drained",
    epoch: old.epoch + (action.kind === "revoke" ? 1 : 0),
  };
  if (action.kind === "drained") {
    if (observed(old, await clock(db)).state === "unclean") throw conflict("NOT_EDITABLE");
    const view = await readView(db, owner, old.view.id);
    if (!view) throw conflict("NOT_FOUND");
    const fence = viewSQL(db, view, false),
      scope = db.native(owner, view.view.documentId, view.target.unitId);
    const nativeFloor = view.source.kind === "artifact" ? "1" : "?>=?";
    sql = `(${fence.sql}) AND (${nativeFloor}) AND EXISTS(SELECT 1 FROM ${view.target.scope.kind === "main" ? "office_native_units" : "office_native_drafts"}
      WHERE scope=? AND head>=?${view.target.scope.kind === "draft" ? " AND worktree=(SELECT worktree FROM office_meta_drafts WHERE owner=? AND id=?)" : ""})
      AND EXISTS(SELECT 1 FROM office_meta_editors WHERE owner=? AND id=? AND expires>${sqlNow})`;
    values.push(
      ...fence.values,
      ...(view.source.kind === "artifact" ? [] : [action.confirmedRevision, view.view.revision]),
      scope,
      action.confirmedRevision,
      ...(view.target.scope.kind === "draft" ? [key, view.target.scope.draftId] : []),
      key,
      old.id,
    );
    confirmed = action.confirmedRevision;
  }
  await db.write(
    `(${sql}) AND EXISTS(SELECT 1 FROM office_meta_editors WHERE owner=? AND id=? AND record=? AND epoch=?)`,
    [...values, key, old.id, previous.row.record, expected],
    [leaseUpdate(db, key, editor, confirmed), leaseEvent(db, owner, previous.view)],
    "STALE_BASIS",
  );
  return editor;
}
