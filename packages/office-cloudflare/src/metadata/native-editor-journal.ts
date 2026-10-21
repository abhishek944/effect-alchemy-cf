import type { NativeEditorLeaf, NativeEditorPermit } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { conflict } from "./store.ts";
import { artifactEdges, completeRefs } from "./artifacts.ts";
import type { EditorContext } from "./native-editor-schema.ts";
import { EditorLeaf } from "./native-editor-schema.ts";
import { liveEditor } from "./native-editor-basis.ts";
import { editorValue } from "./native-editor-value.ts";

export async function stageEditor(
  db: MetadataStore,
  c: EditorContext,
  inputPermit: NativeEditorPermit,
  inputLeaf: NativeEditorLeaf,
): Promise<NativeEditorLeaf> {
  const leaf = db.decode(EditorLeaf, db.encode(EditorLeaf, inputLeaf));
  const bound = await liveEditor(db, c, inputPermit),
    sub = bound.submission;
  const value = await editorValue(db, bound.permit, leaf);
  if (!value) throw conflict("CONTENT_REQUIRED");
  const record = db.encode(EditorLeaf, leaf),
    complete = completeRefs(db, c.target.owner, [leaf.payload]);
  if (sub.leaf_record !== null && sub.leaf_record !== record) throw conflict();
  if (sub.leaf_record === null && sub.state !== "admitted") throw conflict("OUTCOME_UNKNOWN");
  const statements: Statement[] = artifactEdges(db, c.target.owner, "editor-write", leaf.id, [
    leaf.payload,
  ]);
  if (sub.leaf_record === null)
    statements.unshift([
      "UPDATE office_coord_editor_submissions SET leaf_record=?,state='staged' WHERE id=?",
      [record, sub.id],
    ]);
  await db.write(
    `(${bound.live.sql}) AND (${complete.sql})
    AND EXISTS(SELECT 1 FROM office_coord_editor_submissions WHERE id=? AND leaf_record IS ? AND state=?)
    AND EXISTS(SELECT 1 FROM office_native_values WHERE scope=? AND value_hash=? AND header=?)
    AND NOT EXISTS(SELECT 1 FROM office_coord_editor_submissions WHERE scope=? AND id<>? AND json_extract(leaf_record,'$.id')=?)`,
    [
      ...bound.live.values,
      ...complete.values,
      sub.id,
      sub.leaf_record,
      sub.state,
      value.scope,
      value.hash,
      value.header,
      value.scope,
      sub.id,
      leaf.id,
    ],
    statements,
  );
  await liveEditor(db, c, bound.permit);
  return leaf;
}
