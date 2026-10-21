import type { NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { EditorPermit, EditorTurn } from "./native-editor-schema.ts";
import type { EditorContext } from "./native-editor-schema.ts";
import type { DocumentHead } from "./coordinator/rows.ts";
import { boundEditor, editorKey } from "./native-editor-rows.ts";

export function editorTurnStatements(
  db: MetadataStore,
  c: EditorContext,
  head: DocumentHead,
  turn: typeof EditorTurn.Type,
  request: string,
): Statement[] {
  const p = turn.origin,
    owner = db.owner(c.document.owner);
  return [
    [
      `UPDATE office_coord_turns SET state='expired',version=version+1,
      record=json_set(record,'$.state','expired','$.version',version+1) WHERE id=? AND state='held'`,
      [head.current_turn],
    ],
    [
      `INSERT INTO office_coord_turns(id,owner,document,scope,placement_id,command_id,step_id,
      authority_epoch,service_epoch,version,fence,mode,state,deadline,auth_until,authorization_digest,
      subject,editor_id,editor_epoch,channel_id,request,record) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        turn.id,
        owner,
        c.document.documentId,
        head.scope,
        c.placementId,
        p.submissionId,
        p.stepId,
        p.authorityEpoch,
        p.serviceEpoch,
        turn.version,
        turn.fence,
        turn.mode,
        turn.state,
        turn.deadline,
        turn.authNotAfter,
        turn.authorizationDigest,
        "editor",
        c.editorId,
        c.editorEpoch,
        c.channelId,
        request,
        db.encode(EditorTurn, turn),
      ],
    ],
    [
      "UPDATE office_coord_documents SET current_turn=?,turn_fence=? WHERE owner=? AND document=?",
      [turn.id, turn.fence, owner, c.document.documentId],
    ],
    [
      "UPDATE office_native_authority SET command_id=?,step_id=? WHERE scope=? AND epoch=?",
      [p.submissionId, p.stepId, head.scope, p.authorityEpoch],
    ],
  ];
}
/** Durable revocation only. Caller still owns joining any pending foreign SDK/IO work. */
export async function releaseEditor(
  db: MetadataStore,
  c: EditorContext,
  input: NativeEditorPermit,
): Promise<void> {
  const captured = db.decode(EditorPermit, db.encode(EditorPermit, input));
  const key = await editorKey(db, c, false),
    bound = await boundEditor(db, c, captured);
  const old = bound.turn.value,
    p = bound.permit;
  if (old.state === "released") return;
  const next: typeof EditorTurn.Type = { ...old, state: "released", version: old.version + 1 };
  await db.write(
    "EXISTS(SELECT 1 FROM office_coord_turns WHERE id=? AND subject='editor' AND record=?)",
    [old.id, bound.turn.row.record],
    [
      [
        "UPDATE office_coord_turns SET state='released',version=?,record=? WHERE id=?",
        [next.version, db.encode(EditorTurn, next), old.id],
      ],
      [
        "UPDATE office_coord_documents SET current_turn=NULL WHERE owner=? AND document=? AND current_turn=? AND turn_fence=?",
        [key.owner, c.document.documentId, old.id, old.fence],
      ],
      [
        "UPDATE office_native_authority SET command_id=NULL,step_id=NULL WHERE scope=? AND epoch=? AND command_id=? AND step_id=?",
        [key.scope, p.authorityEpoch, p.submissionId, p.stepId],
      ],
      [
        "UPDATE office_coord_editor_submissions SET state='unknown' WHERE id=? AND state IN ('admitted','staged','prepared')",
        [p.submissionId],
      ],
    ],
  );
}
