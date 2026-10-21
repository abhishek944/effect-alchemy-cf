import { Count, EditorAction, decodeWireSync } from "@starter/office-contract";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { invalid, storeEffect } from "../store.ts";
import { activeView, prepareView } from "./views.ts";
import { editorRow, editorRows } from "./leases.ts";
import { acquireEditor, renewEditor } from "./editors.ts";
import { closeEditor } from "./transitions.ts";
export { sessionSchemaStatements, ViewRow, LeaseRow } from "./schemas.ts";

export function createSessions(
  db: MetadataStore,
): Pick<OfficeMetadata, "putView" | "view" | "editor" | "editors" | "changeEditor"> {
  return {
    putView: (input) =>
      storeEffect(async () => {
        const plan = await prepareView(db, input);
        await db.write(plan.fence.sql, plan.fence.values, plan.statements, "AUTHORITY_LOST");
        return plan.record;
      }),
    view: (owner, id) => storeEffect(() => activeView(db, owner, id)),
    editor: (owner, id) => storeEffect(() => editorRow(db, owner, id)),
    editors: (owner, id) => storeEffect(() => editorRows(db, owner, id)),
    changeEditor: (owner, input, expected, resolved) =>
      storeEffect(async () => {
        const action = decodeWireSync(EditorAction)(input);
        db.owner(owner);
        if (action.kind === "acquire") return acquireEditor(db, owner, action, expected, resolved);
        if (expected === null) throw invalid();
        decodeWireSync(Count)(expected);
        if (action.kind === "renew") {
          if (!resolved) throw invalid();
          return renewEditor(db, owner, action.editorId, expected, resolved);
        }
        if (resolved !== null) throw invalid();
        return closeEditor(db, owner, action, expected);
      }),
  };
}
