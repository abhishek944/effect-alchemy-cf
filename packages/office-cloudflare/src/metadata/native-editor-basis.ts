import type { NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict, sqlNow } from "./store.ts";
import { readView } from "./sessions/views.ts";
import { ViewRow } from "./sessions/schemas.ts";
import { viewSQL } from "./sessions/fence.ts";
import { forbidden } from "./coordinator/context.ts";
import { nativeAdmissionFence } from "./coordinator/fence.ts";
import { boundEditor, editorKey } from "./native-editor-rows.ts";
import { EditorPermit } from "./native-editor-schema.ts";
import type { EditorContext } from "./native-editor-schema.ts";

export async function channelBasis(db: MetadataStore, c: EditorContext, viewId: string) {
  const key = await editorKey(db, c),
    view = await readView(db, c.document.owner, viewId);
  if (
    !view ||
    view.view.mode !== "edit" ||
    view.source.kind === "artifact" ||
    canonical(view.target) !== canonical(c.target)
  )
    throw forbidden();
  const native = viewSQL(db, view, false);
  return {
    key,
    view,
    sql: `(${native.sql}) AND ?>${sqlNow}
    AND EXISTS(SELECT 1 FROM office_meta_editors e
      JOIN office_meta_views v ON v.owner=e.owner AND v.id=?
      JOIN office_coord_documents d ON d.owner=e.owner AND d.document=e.document
      JOIN office_coord_placements p ON p.id=d.placement_id
      WHERE e.owner=? AND e.id=? AND e.document=? AND e.epoch=?
      AND e.state='active' AND e.expires>${sqlNow} AND v.expires>${sqlNow} AND v.record=?
      AND json_extract(e.record,'$.editor.view')=json_extract(v.record,'$.view')
      AND d.scope=? AND d.unit=? AND d.placement_id=? AND d.state='live'
      AND d.placement_until>${sqlNow} AND p.state='live' AND p.deadline>${sqlNow}
      AND p.owner=d.owner AND p.document=d.document AND p.scope=d.scope
      AND p.authority_epoch=d.authority_epoch AND p.service_epoch=d.service_epoch
      AND d.authority_epoch=? AND d.service_epoch=?)
    AND NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=?)`,
    values: [
      ...native.values,
      c.notAfter,
      viewId,
      key.owner,
      c.editorId,
      c.document.documentId,
      c.editorEpoch,
      db.encode(ViewRow, view),
      key.scope,
      c.document.unitId,
      c.placementId,
      view.authorityEpoch,
      view.serviceEpoch,
      key.owner,
      c.document.documentId,
    ],
  };
}
export async function editorHead(db: MetadataStore, c: EditorContext) {
  const scope = db.native(c.target.owner, c.target.documentId, c.target.unitId);
  const target = c.target.scope;
  const row =
    target.kind === "main"
      ? await db.first<{ head: number }>(
          "SELECT head FROM office_native_units WHERE scope=? AND lifecycle='active'",
          [scope],
        )
      : await db.first<{ head: number }>(
          `SELECT d.head FROM office_meta_drafts m
      JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
      JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
      WHERE m.owner=? AND m.id=? AND m.document=? AND m.generation=?
      AND w.generation=m.generation AND w.status='draft' AND d.removed=0`,
          [scope, db.owner(c.target.owner), target.draftId, c.target.documentId, target.generation],
        );
  if (!row || !Number.isSafeInteger(row.head) || row.head < 1) throw conflict("NOT_EDITABLE");
  return row.head;
}
export function admissionOf(turn: {
  id: string;
  fence: number;
  authorizationDigest: string;
  authNotAfter: number;
}) {
  return {
    turnId: turn.id,
    fence: turn.fence,
    authorizationDigest: turn.authorizationDigest,
    notAfter: turn.authNotAfter,
  };
}
export async function liveEditor(db: MetadataStore, c: EditorContext, input: NativeEditorPermit) {
  const captured = db.decode(EditorPermit, db.encode(EditorPermit, input));
  await editorKey(db, c);
  const bound = await boundEditor(db, c, captured),
    p = bound.permit;
  if (bound.turn.value.authorizationDigest !== c.authorizationDigest) throw forbidden();
  const fence = nativeAdmissionFence(
    bound.turn.row.scope,
    admissionOf(bound.turn.value),
    p.submissionId,
    p.stepId,
    p.authorityEpoch,
    "stage",
  );
  const live = {
    sql: `(${fence.sql}) AND ?>${sqlNow} AND EXISTS(SELECT 1 FROM office_native_authority
      WHERE scope=? AND epoch=? AND command_id=? AND step_id=?)`,
    values: [
      ...fence.values,
      c.notAfter,
      bound.turn.row.scope,
      p.authorityEpoch,
      p.submissionId,
      p.stepId,
    ],
  };
  if (!(await db.first(`SELECT 1 WHERE ${live.sql}`, live.values)))
    throw conflict("AUTHORITY_LOST");
  return { ...bound, live };
}
