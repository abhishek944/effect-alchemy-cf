import type { OperationRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";
/** Domain metadata identity consistency; fresh role/session/native admission remains the caller's responsibility. */
export function operationTarget(db: MetadataStore, record: OperationRecord): PredicateSQL {
  const intent = record.intent;
  if (
    intent.kind === "execute" ||
    intent.kind === "import-into" ||
    intent.kind === "ready" ||
    intent.kind === "reopen" ||
    intent.kind === "discard"
  ) {
    const target =
      intent.kind === "execute" || intent.kind === "import-into"
        ? intent.input.target
        : intent.input;
    return {
      sql: "EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND worktree=? AND generation=?)",
      values: [
        db.owner(record.owner),
        target.draftId,
        record.documentId,
        record.worktreeId,
        target.generation,
      ],
    };
  }
  if (intent.kind === "render" || intent.kind === "export")
    return {
      sql: `EXISTS(SELECT 1 FROM office_meta_views WHERE owner=? AND id=? AND document=? AND json_extract(record,'$.target.unitId')=?)`,
      values: [db.owner(record.owner), intent.input.viewId, record.documentId, record.unitId],
    };
  return { sql: "1", values: [] };
}
