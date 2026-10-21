import type {
  NativeWriteRecord,
  OperationRecord,
  SerialAdmission,
} from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import { conflict } from "../store.ts";
import { preparedSlot, acceptedReceipt } from "../write-context.ts";
import { completeRefs } from "../artifacts.ts";
import { WriteRow } from "../schemas.ts";
import type { Turn } from "./types.ts";

export function originalEvidence(
  db: MetadataStore,
  operation: OperationRecord,
  write: NativeWriteRecord,
): PredicateSQL {
  if (
    write.operationId !== operation.receipt.operationId ||
    write.documentId !== operation.documentId ||
    write.unitId !== operation.unitId ||
    write.preparedReceipt === null
  )
    throw conflict("OUTCOME_UNKNOWN");
  const slot = preparedSlot(db, operation.owner, write, write.preparedReceipt);
  const receipt = acceptedReceipt(db, operation.owner, write, write.preparedReceipt);
  const payload = completeRefs(db, operation.owner, [write.payload]);
  return {
    sql: `(${slot.sql}) AND (${receipt.sql}) AND (${payload.sql})
      AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND record=?)`,
    values: [
      ...slot.values,
      ...receipt.values,
      ...payload.values,
      db.owner(operation.owner),
      write.id,
      db.encode(WriteRow, write),
    ],
  };
}
export async function continuation(
  db: MetadataStore,
  operation: OperationRecord,
  admission: SerialAdmission,
): Promise<{ nativePlan: Turn["nativePlan"]; predicate: PredicateSQL } | null> {
  const rows = await db.all<{ record: string }>(
    "SELECT record FROM office_meta_writes WHERE owner=? AND operation=? ORDER BY id LIMIT 2",
    [db.owner(operation.owner), operation.receipt.operationId],
  );
  if (rows.length === 0) return null;
  const first = rows[0];
  if (rows.length !== 1 || !first) throw conflict("OUTCOME_UNKNOWN");
  const write = db.decode(WriteRow, first.record);
  const evidence = originalEvidence(db, operation, write);
  const scope = db.native(operation.owner, operation.documentId, operation.unitId);
  if (
    operation.intent.kind === "ready" &&
    operation.artifacts.proposal === null &&
    write.receiptKey.kind === "transition" &&
    write.receiptKey.target === "ready" &&
    write.receiptKey.worktreeId === operation.worktreeId &&
    write.receiptKey.generation === operation.intent.input.generation &&
    write.generation === operation.intent.input.generation &&
    write.baseRevision !== null &&
    admission.expectedHead === write.baseRevision
  ) {
    return {
      nativePlan: "ready-capture",
      predicate: {
        sql: `(${evidence.sql}) AND EXISTS(SELECT 1 FROM office_native_worktrees w
          JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
          WHERE w.scope=? AND w.id=? AND w.generation=? AND w.status='ready'
            AND d.head=? AND d.ready=d.head AND d.removed=0)`,
        values: [
          ...evidence.values,
          scope,
          operation.worktreeId,
          operation.intent.input.generation,
          write.baseRevision,
        ],
      },
    };
  }
  if (
    operation.intent.kind === "create" &&
    operation.intent.input.destination === "new-draft" &&
    write.receiptKey.kind === "create-worktree" &&
    write.receiptKey.worktreeId === operation.worktreeId &&
    write.worktreeId === operation.worktreeId &&
    write.generation !== null
  ) {
    return {
      nativePlan: "newborn-unit",
      predicate: {
        sql: `(${evidence.sql}) AND EXISTS(SELECT 1 FROM office_native_worktrees
          WHERE scope=? AND id=? AND generation=? AND status='draft')
          AND NOT EXISTS(SELECT 1 FROM office_native_drafts WHERE scope=? AND worktree=?)
          AND NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)
          AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=?
            AND json_extract(record,'$.receiptKey.kind')='create-draft')`,
        values: [
          ...evidence.values,
          scope,
          operation.worktreeId,
          write.generation,
          scope,
          operation.worktreeId,
          scope,
          db.owner(operation.owner),
          operation.receipt.operationId,
        ],
      },
    };
  }
  throw conflict("OUTCOME_UNKNOWN");
}
