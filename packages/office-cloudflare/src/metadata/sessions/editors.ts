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
  const plan = await prepareView(db, input, false),
    key = db.owner(owner),
    branch = viewBranch(plan.record),
    now = await clock(db);
  // Each ID owns its own revocation epoch; another open never invalidates this session.
  const epoch = 1;
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
  await db.write(
    `(${plan.fence.sql}) AND (${barrier.sql}) AND ?>${sqlNow}`,
    [...plan.fence.values, ...barrier.values, editor.expiresAt],
    [
      ...plan.statements,
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
    "NOT_EDITABLE",
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
    WHERE owner=? AND id=? AND epoch=? AND state='active' AND expires>${sqlNow} AND record=?)`,
    [...plan.fence.values, ...barrier.values, key, id, expected, previous.row.record],
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
