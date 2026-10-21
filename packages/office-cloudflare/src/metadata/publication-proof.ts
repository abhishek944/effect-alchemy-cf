import type { OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";
import { canonical, conflict } from "./store.ts";
import { WriteRow } from "./schemas.ts";
import { nativeReceiptAction } from "./native-actions.ts";
/** Expected data comes from saved PREPARATION, never reconstructed from the receipt being observed. */
export async function publicationProof(
  db: MetadataStore,
  owner: OwnerScope,
  operationId: string,
  scope: string,
): Promise<PredicateSQL> {
  const rows = await db.all<{ record: string }>(
    "SELECT record FROM office_meta_writes WHERE owner=? AND operation=? ORDER BY id LIMIT 101",
    [db.owner(owner), operationId],
  );
  if (rows.length > 100) throw conflict("HISTORY_INCOMPLETE");
  const writes = rows.map((row) => db.decode(WriteRow, row.record));
  if (writes.some((write) => ["staged", "dispatching", "unknown"].includes(write.phase)))
    throw conflict("OUTCOME_UNKNOWN");
  const accepted = writes.filter((write) => write.phase === "confirmed");
  if (accepted.some((write) => write.preparedReceipt === null)) throw conflict("OUTCOME_UNKNOWN");
  const expected = accepted.map((write) => ({
    id: write.id,
    step: write.stepId,
    action: nativeReceiptAction(write.receiptKey),
    payload: write.payload.digest,
    fingerprint: write.preparedReceipt?.fingerprint,
    epoch: write.preparedReceipt?.authorityEpoch,
  }));
  return {
    sql: `NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase IN ('staged','dispatching','unknown'))
    AND (SELECT count(*) FROM office_meta_writes WHERE owner=? AND operation=? AND phase='confirmed')=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM office_meta_writes mw
      JOIN office_native_prepared_slots p ON p.scope=? AND p.command_id=mw.operation AND p.step_id=json_extract(mw.record,'$.stepId') AND p.write_id=mw.id
      JOIN office_native_receipts n ON n.scope=p.scope AND n.command_id=p.command_id AND n.step_id=p.step_id AND n.action=p.action AND n.fingerprint=p.fingerprint AND n.epoch=p.epoch
      WHERE mw.owner=? AND mw.id=json_extract(j.value,'$.id') AND mw.phase='confirmed' AND mw.operation=?
      AND p.step_id=json_extract(j.value,'$.step') AND p.action=json_extract(j.value,'$.action') AND p.payload_digest=json_extract(j.value,'$.payload')
      AND p.fingerprint=json_extract(j.value,'$.fingerprint') AND p.epoch=json_extract(j.value,'$.epoch')
      AND p.payload_digest=json_extract(mw.record,'$.payload.digest') AND p.fingerprint=json_extract(mw.record,'$.preparedReceipt.fingerprint')
      AND p.epoch=json_extract(mw.record,'$.preparedReceipt.authorityEpoch')))`,
    values: [
      db.owner(owner),
      operationId,
      db.owner(owner),
      operationId,
      expected.length,
      canonical(expected),
      scope,
      db.owner(owner),
      operationId,
    ],
  };
}
