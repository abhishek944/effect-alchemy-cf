import { Count, Id, decodeWireSync, OfficeLimited, safeFailure } from "@starter/office-contract";
import type { Editor } from "@starter/office-contract";
import type { OwnerScope, ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { canonical, conflict, invalid, sqlNow } from "../store.ts";
import { LeaseRow } from "./schemas.ts";
import { readView } from "./views.ts";
import { viewBranch } from "./fence.ts";

export type Lease = typeof LeaseRow.Type;
export type LeaseStored = {
  document: string;
  branch: string;
  epoch: number;
  state: string;
  expires: number;
  record: string;
};
export async function clock(db: MetadataStore): Promise<number> {
  const row = await db.first<{ now: number }>(`SELECT ${sqlNow} AS now`);
  if (!row) throw invalid();
  return decodeWireSync(Count)(row.now);
}
export async function leaseRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<{ lease: Lease; row: LeaseStored; view: ViewRecord } | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<LeaseStored>(
    "SELECT document,branch,epoch,state,expires,record FROM office_meta_editors WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  if (!row) return null;
  const lease = db.decode(LeaseRow, row.record),
    editor = lease.editor;
  const view = await readView(db, owner, editor.view.id);
  if (
    !view ||
    editor.id !== id ||
    row.document !== editor.view.documentId ||
    row.branch !== viewBranch(view) ||
    row.epoch !== editor.epoch ||
    row.state !== editor.state ||
    row.expires !== editor.expiresAt ||
    editor.epoch < 1 ||
    editor.expiresAt > editor.view.expiresAt ||
    (editor.state === "drained") !== (lease.confirmedRevision !== null) ||
    canonical({ ...editor.view, expiresAt: 0 }) !== canonical({ ...view.view, expiresAt: 0 })
  )
    throw conflict();
  return { lease, row, view };
}
export function observed(editor: Editor, now: number): Editor {
  return (editor.state === "active" || editor.state === "draining") && editor.expiresAt <= now
    ? { ...editor, state: "unclean" }
    : editor;
}
export async function editorRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<Editor | null> {
  const value = await leaseRow(db, owner, id);
  return value ? observed(value.lease.editor, await clock(db)) : null;
}
export async function editorRows(
  db: MetadataStore,
  owner: OwnerScope,
  documentId: string,
): Promise<readonly Editor[]> {
  decodeWireSync(Id)(documentId);
  const rows = await db.all<{ id: string }>(
    "SELECT id FROM office_meta_editors WHERE owner=? AND document=? AND state IN ('active','draining','unclean') ORDER BY id LIMIT 101",
    [db.owner(owner), documentId],
  );
  if (rows.length > 100) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  const result: Editor[] = [];
  for (const row of rows) {
    const editor = await editorRow(db, owner, row.id);
    if (editor) result.push(editor);
  }
  if (new TextEncoder().encode(canonical(result)).byteLength > db.limits.responseBytes)
    throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  return result;
}
