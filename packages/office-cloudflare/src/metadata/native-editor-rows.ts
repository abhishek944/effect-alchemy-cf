import type { NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict } from "./store.ts";
import { forbidden, requireContext } from "./coordinator/context.ts";
import { requireCoordinatorSchema } from "./coordinator/schema.ts";
import type { StoredTurn } from "./coordinator/rows.ts";
import { Channel, EditorPermit, EditorTurn, Submission } from "./native-editor-schema.ts";
import type { EditorContext } from "./native-editor-schema.ts";

export async function editorKey(db: MetadataStore, c: EditorContext, live = true) {
  if (live) return requireContext(db, c, c.document);
  await requireCoordinatorSchema(db.options.database);
  return {
    owner: db.owner(c.document.owner),
    scope: db.native(c.document.owner, c.document.documentId, c.document.unitId),
  };
}
export async function channelRow(db: MetadataStore, c: EditorContext) {
  const row = await db.first<{
    id: string;
    owner: string;
    document: string;
    unit: string;
    editor_id: string;
    editor_epoch: number;
    view_id: string;
    principal: string;
    session_epoch: number;
    member_id: string;
    deadline: number;
    version: number;
    state: string;
    record: string;
  }>("SELECT * FROM office_coord_channels WHERE id=?", [c.channelId]);
  if (!row) return null;
  const value = db.decode(Channel, row.record);
  if (
    row.id !== value.id ||
    row.owner !== db.owner(c.document.owner) ||
    row.document !== c.document.documentId ||
    row.unit !== c.document.unitId ||
    row.editor_id !== value.editorId ||
    row.editor_epoch !== value.editorEpoch ||
    row.view_id !== value.viewId ||
    row.principal !== value.principalId ||
    row.session_epoch !== value.sessionEpoch ||
    row.member_id !== value.memberId ||
    row.deadline !== value.until ||
    row.version !== value.version ||
    row.state !== value.state ||
    value.id !== c.channelId ||
    value.editorId !== c.editorId ||
    value.editorEpoch !== c.editorEpoch ||
    value.principalId !== c.principalId ||
    value.sessionEpoch !== c.sessionEpoch ||
    value.memberId !== c.memberId ||
    value.placementId !== c.placementId ||
    canonical(value.target) !== canonical(c.target)
  )
    throw forbidden();
  return { row, value };
}
export async function submissionRow(db: MetadataStore, id: string) {
  const row = await db.first<typeof Submission.Type>(
    "SELECT * FROM office_coord_editor_submissions WHERE id=?",
    [id],
  );
  return row ? db.decode(Submission, db.encode(Submission, row)) : null;
}
export async function editorTurnRow(db: MetadataStore, id: string) {
  const row = await db.first<StoredTurn>("SELECT * FROM office_coord_turns WHERE id=?", [id]);
  if (!row) return null;
  const value = db.decode(EditorTurn, row.record),
    p = value.origin;
  if (
    row.subject !== "editor" ||
    row.id !== value.id ||
    row.owner !== db.owner(p.target.owner) ||
    row.document !== p.target.documentId ||
    row.scope !== db.native(p.target.owner, p.target.documentId, p.target.unitId) ||
    row.placement_id !== value.placementId ||
    row.command_id !== p.submissionId ||
    row.step_id !== p.stepId ||
    row.authority_epoch !== p.authorityEpoch ||
    row.service_epoch !== p.serviceEpoch ||
    row.version !== value.version ||
    row.fence !== value.fence ||
    row.mode !== value.mode ||
    row.state !== value.state ||
    row.deadline !== value.deadline ||
    row.auth_until !== value.authNotAfter ||
    row.authorization_digest !== value.authorizationDigest ||
    row.channel_id !== p.channelId ||
    row.editor_id !== p.editorId ||
    row.editor_epoch !== p.editorEpoch ||
    canonical(value.target) !== canonical(p.target)
  )
    throw conflict();
  return { row, value };
}
export async function boundEditor(db: MetadataStore, c: EditorContext, input: NativeEditorPermit) {
  const permit = db.decode(EditorPermit, db.encode(EditorPermit, input));
  const channel = await channelRow(db, c),
    submission = await submissionRow(db, permit.submissionId);
  const turn = submission ? await editorTurnRow(db, submission.turn_id) : null;
  if (
    !channel ||
    !submission ||
    !turn ||
    canonical(turn.value.origin) !== canonical(permit) ||
    canonical(permit.target) !== canonical(c.target) ||
    submission.scope !== turn.row.scope ||
    submission.branch !== canonical(c.target.scope) ||
    submission.sid !== permit.sid ||
    submission.req_id !== permit.reqId ||
    submission.channel_id !== c.channelId ||
    submission.editor_id !== c.editorId ||
    submission.editor_epoch !== c.editorEpoch ||
    permit.channelId !== c.channelId ||
    permit.editorId !== c.editorId ||
    permit.editorEpoch !== c.editorEpoch ||
    permit.memberId !== c.memberId ||
    turn.value.principalId !== c.principalId ||
    turn.value.sessionEpoch !== c.sessionEpoch ||
    turn.value.placementId !== c.placementId ||
    channel.value.authorityEpoch !== permit.authorityEpoch ||
    channel.value.serviceEpoch !== permit.serviceEpoch
  )
    throw forbidden();
  return { permit, channel, submission, turn };
}
