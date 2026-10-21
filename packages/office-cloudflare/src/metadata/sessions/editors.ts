import { Count, decodeWireSync } from "@starter/office-contract";
import type { Editor, EditorAction } from "@starter/office-contract";
import type { OwnerScope, ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "../store.ts";
import { canonical, conflict, invalid, sqlNow } from "../store.ts";
import { noBarrier } from "../native-fence.ts";
import { prepareView } from "./views.ts";
import { viewBranch } from "./fence.ts";
import { clock, leaseRow } from "./leases.ts";
import { LeaseRow } from "./schemas.ts";
import { leaseEvent } from "./events.ts";

export async function acquireEditor(
  db: MetadataStore,
  owner: OwnerScope,
  action: Extract<EditorAction, { kind: "acquire" }>,
  expected: number | null,
  input: ViewRecord | null,
): Promise<Editor> {
  if (
    expected !== null ||
    !input ||
    canonical(input.owner) !== canonical(owner) ||
    canonical(action.target) !==
      canonical({ documentId: input.target.documentId, scope: input.target.scope })
  )
    throw invalid();
  const plan = await prepareView(db, input, true),
    key = db.owner(owner),
    branch = viewBranch(plan.record);
  const previous = await db.first<{ epoch: number }>(
    "SELECT epoch FROM office_meta_editor_epochs WHERE owner=? AND document=? AND branch=?",
    [key, action.target.documentId, branch],
  );
  const epoch = decodeWireSync(Count)((previous?.epoch ?? 0) + 1),
    now = await clock(db);
  const ttl = editorTtl(db),
    editor: Editor = {
      id: crypto.randomUUID(),
      epoch,
      view: plan.record.view,
      expiresAt: Math.min(plan.record.view.expiresAt, now + ttl),
      state: "active",
    };
  const barrier =
    editor.view.mode === "edit"
      ? noBarrier(db, owner, action.target.documentId)
      : { sql: "1", values: [] };
  const epochSQL = previous
    ? "EXISTS(SELECT 1 FROM office_meta_editor_epochs WHERE owner=? AND document=? AND branch=? AND epoch=?)"
    : "NOT EXISTS(SELECT 1 FROM office_meta_editor_epochs WHERE owner=? AND document=? AND branch=?)";
  await db.write(
    `(${plan.fence.sql}) AND (${barrier.sql}) AND ?>${sqlNow} AND ${epochSQL}
    AND NOT EXISTS(SELECT 1 FROM office_meta_editors WHERE owner=? AND document=? AND branch=? AND state IN ('active','draining','unclean'))`,
    [
      ...plan.fence.values,
      ...barrier.values,
      editor.expiresAt,
      key,
      action.target.documentId,
      branch,
      ...(previous ? [previous.epoch] : []),
      key,
      action.target.documentId,
      branch,
    ],
    [
      ...plan.statements,
      [
        "INSERT INTO office_meta_editor_epochs VALUES(?,?,?,?) ON CONFLICT(owner,document,branch) DO UPDATE SET epoch=excluded.epoch",
        [key, action.target.documentId, branch, epoch],
      ],
      [
        "INSERT INTO office_meta_editors VALUES(?,?,?,?,?,?,?,?)",
        [
          key,
          editor.id,
          action.target.documentId,
          branch,
          epoch,
          "active",
          editor.expiresAt,
          db.encode(LeaseRow, { editor, confirmedRevision: null }),
        ],
      ],
      leaseEvent(db, owner, plan.record),
    ],
    "BUSY",
  );
  return editor;
}
export function editorTtl(db: MetadataStore): number {
  const ttl = db.options.editorTtlMs ?? 30000;
  if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 300000) throw invalid();
  return ttl;
}
export async function renewEditor(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
  expected: number,
  input: ViewRecord,
): Promise<Editor> {
  const previous = await leaseRow(db, owner, id);
  if (!previous) throw conflict("NOT_FOUND");
  const old = previous.lease.editor;
  if (
    old.epoch !== expected ||
    old.state !== "active" ||
    input.view.id !== old.view.id ||
    canonical(input.owner) !== canonical(owner)
  )
    throw conflict("NOT_EDITABLE");
  const plan = await prepareView(db, input, false),
    now = await clock(db),
    key = db.owner(owner);
  const editor: Editor = {
    ...old,
    view: plan.record.view,
    expiresAt: Math.min(plan.record.view.expiresAt, now + editorTtl(db)),
  };
  if (editor.expiresAt < old.expiresAt) throw conflict();
  const barrier =
    editor.view.mode === "edit"
      ? noBarrier(db, owner, editor.view.documentId)
      : { sql: "1", values: [] };
  await db.write(
    `(${plan.fence.sql}) AND (${barrier.sql}) AND EXISTS(SELECT 1 FROM office_meta_editors
    WHERE owner=? AND id=? AND epoch=? AND state='active' AND expires>${sqlNow} AND record=?)
    AND EXISTS(SELECT 1 FROM office_meta_editor_epochs WHERE owner=? AND document=? AND branch=? AND epoch=?)`,
    [
      ...plan.fence.values,
      ...barrier.values,
      key,
      id,
      expected,
      previous.row.record,
      key,
      old.view.documentId,
      previous.row.branch,
      expected,
    ],
    [...plan.statements, leaseUpdate(db, key, editor, null), leaseEvent(db, owner, plan.record)],
    "NOT_EDITABLE",
  );
  return editor;
}
export function leaseUpdate(
  db: MetadataStore,
  key: string,
  editor: Editor,
  confirmedRevision: number | null,
): Statement {
  return [
    "UPDATE office_meta_editors SET epoch=?,state=?,expires=?,record=? WHERE owner=? AND id=?",
    [
      editor.epoch,
      editor.state,
      editor.expiresAt,
      db.encode(LeaseRow, { editor, confirmedRevision }),
      key,
      editor.id,
    ],
  ];
}
