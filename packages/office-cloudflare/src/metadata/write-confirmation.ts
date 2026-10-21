import { Revision, decodeWireSync } from "@starter/office-contract";
import type { WritePermit, NativeWriteRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { conflict, invalid, missing } from "./store.ts";
import { WriteRow } from "./schemas.ts";
import { writeRow, journalAuthority, preparedSlot, acceptedReceipt } from "./write-context.ts";
import { contentRevision, nativeReceiptAction } from "./native-actions.ts";
import { eventStatement, operationEvent } from "./events.ts";
export async function confirmWrite(
  db: MetadataStore,
  permit: WritePermit,
  id: string,
  revision: number | null,
): Promise<void> {
  if (revision !== null) decodeWireSync(Revision)(revision);
  const write = await writeRow(db, permit.owner, id);
  if (!write) throw missing();
  if (
    write.operationId !== permit.operationId ||
    write.documentId !== permit.documentId ||
    write.unitId !== permit.target.unitId ||
    revision !== contentRevision(write)
  )
    throw invalid();
  const binding = write.preparedReceipt;
  if (!binding) throw conflict("OUTCOME_UNKNOWN");
  const slot = preparedSlot(db, permit.owner, write, binding),
    accepted = acceptedReceipt(db, permit.owner, write, binding);
  const authority = journalAuthority(db, permit),
    owner = db.owner(permit.owner);
  if (write.phase === "confirmed") {
    if (
      write.acceptedRevision !== revision ||
      !(await db.first(`SELECT 1 WHERE ${slot.sql} AND ${accepted.sql}`, [
        ...slot.values,
        ...accepted.values,
      ]))
    )
      throw conflict();
    return;
  }
  if (!["dispatching", "unknown"].includes(write.phase)) throw conflict("NOT_EDITABLE");
  const result: NativeWriteRecord = { ...write, phase: "confirmed", acceptedRevision: revision };
  await db.write(
    `${authority.sql} AND ${slot.sql} AND ${accepted.sql} AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND record=?)`,
    [
      ...authority.values,
      ...slot.values,
      ...accepted.values,
      owner,
      id,
      db.encode(WriteRow, write),
    ],
    [
      [
        "UPDATE office_meta_writes SET phase='confirmed',accepted_revision=?,record=? WHERE owner=? AND id=?",
        [revision, db.encode(WriteRow, result), owner, id],
      ],
      [
        "UPDATE office_native_prepared_slots SET enabled=0 WHERE scope=? AND command_id=? AND step_id=? AND action=? AND write_id=?",
        [
          db.native(permit.owner, write.documentId, write.unitId),
          write.operationId,
          write.stepId,
          nativeReceiptAction(write.receiptKey),
          id,
        ],
      ],
      eventStatement(db, permit.owner, {
        ...operationEvent(write.documentId, write.operationId),
        revision,
        kind: revision === null ? "operation-state" : "revision-confirmed",
      }),
    ],
  );
}
