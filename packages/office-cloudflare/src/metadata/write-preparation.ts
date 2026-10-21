import {
  NativeReceiptBinding as Binding,
  type NativeReceiptBinding,
  type WritePermit,
  type NativeWriteRecord,
} from "@starter/office-server/ports";
import { decodeWireSync } from "@starter/office-contract";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict, missing } from "./store.ts";
import { WriteRow, Permit } from "./schemas.ts";
import { writeRow, journalAuthority, validateJournal, preparedSlot } from "./write-context.ts";
import { completeRefs } from "./artifacts.ts";
import { mergeFence } from "./merge-fence.ts";
import { noBarrier } from "./native-fence.ts";
import { nativeReceiptAction } from "./native-actions.ts";
export async function prepareWrite(
  db: MetadataStore,
  permit: WritePermit,
  id: string,
  input: NativeReceiptBinding,
): Promise<NativeWriteRecord> {
  const binding = decodeWireSync(Binding)(input),
    write = await writeRow(db, permit.owner, id);
  if (!write) throw missing();
  validateJournal(permit, write);
  const authority = journalAuthority(db, permit),
    owner = db.owner(permit.owner);
  if (binding.authorityEpoch !== permit.authorityEpoch) throw conflict("AUTHORITY_LOST");
  if (
    !(await db.first("SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND binding=?", [
      owner,
      id,
      db.encode(Permit, permit),
    ]))
  )
    throw conflict();
  const merge = mergeFence(db, permit),
    clear = noBarrier(db, permit.owner, permit.documentId);
  const liveOperation = `EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND phase NOT IN ('confirmed','failed-before-submit','conflict','cancelled-before-dispatch'))
    AND CASE WHEN EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND json_extract(record,'$.intent.kind')='merge') THEN (${merge.sql}) ELSE (${clear.sql}) END`;
  const liveValues = [
    owner,
    write.operationId,
    owner,
    write.operationId,
    ...merge.values,
    ...clear.values,
  ];
  const slot = preparedSlot(db, permit.owner, write, binding);
  if (write.preparedReceipt !== null) {
    if (
      canonical(write.preparedReceipt) !== canonical(binding) ||
      !(await db.first(`SELECT 1 WHERE ${slot.sql} AND ${authority.sql} AND ${liveOperation}`, [
        ...slot.values,
        ...authority.values,
        ...liveValues,
      ]))
    )
      throw conflict();
    return write;
  }
  if (write.phase !== "staged") throw conflict("NOT_EDITABLE");
  const scope = db.native(permit.owner, write.documentId, write.unitId),
    action = nativeReceiptAction(write.receiptKey);
  const result: NativeWriteRecord = { ...write, preparedReceipt: binding, phase: "dispatching" };
  const complete = completeRefs(db, permit.owner, [write.payload]);
  await db.write(
    `${authority.sql} AND ${complete.sql} AND ${liveOperation}
    AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND record=? AND binding=?)
    AND NOT EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND (write_id=? OR (command_id=? AND step_id=? AND action=?)))
    AND NOT EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=?)`,
    [
      ...authority.values,
      ...complete.values,
      ...liveValues,
      owner,
      id,
      db.encode(WriteRow, write),
      db.encode(Permit, permit),
      scope,
      id,
      write.operationId,
      write.stepId,
      action,
      scope,
      write.operationId,
      write.stepId,
      action,
    ],
    [
      [
        "UPDATE office_meta_writes SET phase='dispatching',record=? WHERE owner=? AND id=?",
        [db.encode(WriteRow, result), owner, id],
      ],
      [
        "INSERT INTO office_native_prepared_slots VALUES(?,?,?,?,?,?,?,?,1)",
        [
          scope,
          write.operationId,
          write.stepId,
          action,
          id,
          write.payload.digest,
          binding.fingerprint,
          binding.authorityEpoch,
        ],
      ],
    ],
  );
  return result;
}
