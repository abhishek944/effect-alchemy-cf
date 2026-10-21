import { NativeReceiptBinding } from "@starter/office-server/ports";
import type { NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { conflict } from "./store.ts";
import { completeRefs } from "./artifacts.ts";
import { nativeReceiptAction } from "./native-actions.ts";
import { EditorLeaf } from "./native-editor-schema.ts";
import type { EditorContext } from "./native-editor-schema.ts";
import { liveEditor } from "./native-editor-basis.ts";
import { editorValue } from "./native-editor-value.ts";

export async function prepareEditor(
  db: MetadataStore,
  c: EditorContext,
  inputPermit: NativeEditorPermit,
  id: string,
  input: NativeReceiptBinding,
): Promise<{ readonly writeId: string; readonly payloadDigest: string }> {
  const binding = db.decode(NativeReceiptBinding, db.encode(NativeReceiptBinding, input));
  const bound = await liveEditor(db, c, inputPermit),
    sub = bound.submission,
    p = bound.permit;
  if (!sub.leaf_record || binding.authorityEpoch !== p.authorityEpoch)
    throw conflict("OUTCOME_UNKNOWN");
  const leaf = db.decode(EditorLeaf, sub.leaf_record),
    encoded = db.encode(NativeReceiptBinding, binding);
  if (leaf.id !== id || (sub.prepared_record !== null && sub.prepared_record !== encoded))
    throw conflict();
  const value = await editorValue(db, p, leaf);
  if (!value) throw conflict("CONTENT_REQUIRED");
  const action = nativeReceiptAction(leaf.receipt),
    scope = value.scope;
  const slot = [
    scope,
    p.submissionId,
    p.stepId,
    action,
    id,
    leaf.payload.digest,
    binding.fingerprint,
    binding.authorityEpoch,
  ];
  const map = [...slot, bound.turn.value.id, bound.turn.value.fence];
  const fresh = sub.prepared_record === null;
  if (fresh && sub.state !== "staged") throw conflict("OUTCOME_UNKNOWN");
  const ready = fresh
    ? `NOT EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND (write_id=? OR (command_id=? AND step_id=? AND action=?)))
      AND NOT EXISTS(SELECT 1 FROM office_coord_preparations WHERE scope=? AND (write_id=? OR (command_id=? AND step_id=? AND action=?)))`
    : `EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND command_id=? AND step_id=? AND action=?
        AND write_id=? AND payload_digest=? AND fingerprint=? AND epoch=? AND enabled=1)
      AND EXISTS(SELECT 1 FROM office_coord_preparations WHERE scope=? AND command_id=? AND step_id=? AND action=?
        AND write_id=? AND payload_digest=? AND fingerprint=? AND original_epoch=? AND turn_id=? AND turn_fence=?)`;
  const collisions = [scope, id, p.submissionId, p.stepId, action];
  const complete = completeRefs(db, c.target.owner, [leaf.payload]);
  await db.write(
    `(${bound.live.sql}) AND (${ready}) AND (${complete.sql})
    AND EXISTS(SELECT 1 FROM office_coord_editor_submissions WHERE id=? AND leaf_record=? AND prepared_record IS ? AND state=?)
    AND EXISTS(SELECT 1 FROM office_native_values WHERE scope=? AND value_hash=? AND header=?)
    AND NOT EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=?)`,
    [
      ...bound.live.values,
      ...(fresh ? [...collisions, ...collisions] : [...slot, ...map]),
      ...complete.values,
      sub.id,
      sub.leaf_record,
      sub.prepared_record,
      sub.state,
      scope,
      value.hash,
      value.header,
      scope,
      p.submissionId,
      p.stepId,
      action,
    ],
    [
      ["INSERT OR IGNORE INTO office_native_prepared_slots VALUES(?,?,?,?,?,?,?,?,1)", slot],
      ["INSERT OR IGNORE INTO office_coord_preparations VALUES(?,?,?,?,?,?,?,?,?,?)", map],
      [
        "UPDATE office_coord_editor_submissions SET state='prepared',prepared_record=? WHERE id=?",
        [encoded, sub.id],
      ],
    ],
  );
  await liveEditor(db, c, p);
  return { writeId: id, payloadDigest: leaf.payload.digest };
}
