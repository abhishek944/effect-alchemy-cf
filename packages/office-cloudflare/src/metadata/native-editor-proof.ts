import { NativeReceiptBinding } from "@starter/office-server/ports";
import type { NativeEditorObservation, NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { conflict, sqlNow } from "./store.ts";
import { completeRefs } from "./artifacts.ts";
import { nativeReceiptAction } from "./native-actions.ts";
import { Client, EditorLeaf, EditorPermit } from "./native-editor-schema.ts";
import type { EditorContext } from "./native-editor-schema.ts";
import { boundEditor, editorKey } from "./native-editor-rows.ts";
import { editorValue } from "./native-editor-value.ts";

/** Passive exact original metadata only. Never renews a grant, decodes a frame or reconstructs preparation. */
export async function observeEditor(
  db: MetadataStore,
  c: EditorContext,
  input: NativeEditorPermit,
): Promise<NativeEditorObservation> {
  const captured = db.decode(EditorPermit, db.encode(EditorPermit, input));
  await editorKey(db, c);
  const bound = await boundEditor(db, c, captured),
    sub = bound.submission,
    p = bound.permit;
  if (sub.leaf_record === null || sub.prepared_record === null) return { state: "unknown" };
  const leaf = db.decode(EditorLeaf, sub.leaf_record),
    binding = db.decode(NativeReceiptBinding, sub.prepared_record);
  if (binding.authorityEpoch !== p.authorityEpoch) throw conflict();
  const client = db.decode(Client, sub.client_ref);
  if (client.sid !== p.sid || client.reqId !== p.reqId) throw conflict();
  const value = await editorValue(db, p, leaf);
  if (!value) return { state: "unknown" };
  const action = nativeReceiptAction(leaf.receipt),
    scope = value.scope;
  const tuple = [
    scope,
    p.submissionId,
    p.stepId,
    action,
    leaf.id,
    leaf.payload.digest,
    binding.fingerprint,
    binding.authorityEpoch,
  ];
  const payload = completeRefs(db, c.target.owner, [leaf.payload, client.client]);
  const sql = `EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND command_id=? AND step_id=? AND action=?
      AND write_id=? AND payload_digest=? AND fingerprint=? AND epoch=? AND enabled=1)
    AND EXISTS(SELECT 1 FROM office_coord_preparations WHERE scope=? AND command_id=? AND step_id=? AND action=?
      AND write_id=? AND payload_digest=? AND fingerprint=? AND original_epoch=? AND turn_id=? AND turn_fence=?)
    AND EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=? AND fingerprint=? AND epoch=?)
    AND EXISTS(SELECT 1 FROM office_coord_accepted_headers h JOIN office_native_values v ON v.scope=h.scope AND v.value_hash=h.value_hash
      WHERE h.scope=? AND h.command_id=? AND h.step_id=? AND h.action=? AND h.write_id=? AND h.payload_digest=?
      AND h.fingerprint=? AND h.original_epoch=? AND h.value_hash=? AND v.kind='changeset' AND v.header=?)
    AND EXISTS(SELECT 1 FROM office_coord_editor_submissions WHERE id=? AND leaf_record=? AND prepared_record=?)
    AND (${payload.sql}) AND ?>${sqlNow}`;
  const values = [
    ...tuple,
    ...tuple,
    sub.turn_id,
    bound.turn.value.fence,
    scope,
    p.submissionId,
    p.stepId,
    action,
    binding.fingerprint,
    binding.authorityEpoch,
    ...tuple,
    value.hash,
    value.header,
    sub.id,
    sub.leaf_record,
    sub.prepared_record,
    ...payload.values,
    c.notAfter,
  ];
  if (!(await db.first(`SELECT 1 WHERE ${sql}`, values))) return { state: "unknown" };
  if (sub.accepted_revision !== null && sub.accepted_revision !== leaf.committed.revision)
    throw conflict();
  await db.write(sql, values, [
    [
      "UPDATE office_coord_editor_submissions SET state='confirmed',accepted_revision=? WHERE id=?",
      [leaf.committed.revision, sub.id],
    ],
  ]);
  await editorKey(db, c);
  return {
    state: "confirmed",
    binding,
    acceptedRevision: leaf.committed.revision,
    committed: leaf.committed,
  };
}
