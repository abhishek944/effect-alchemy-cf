import { Id, decodeWireSync } from "@starter/office-contract";
import type {
  NativeWriteRecord,
  NativeReceiptBinding,
  OwnerScope,
  WritePermit,
} from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import type { PredicateSQL } from "./native-fence.ts";
import { canonical, invalid } from "./store.ts";
import { Permit, WriteRow } from "./schemas.ts";
import { nativeReceiptAction, contentRevision } from "./native-actions.ts";
export async function writeRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<NativeWriteRecord | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_writes WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  return row ? db.decode(WriteRow, row.record) : null;
}
export function writeIdentity(write: NativeWriteRecord) {
  const {
    phase: _phase,
    acceptedRevision: _accepted,
    preparedReceipt: _prepared,
    ...identity
  } = write;
  return identity;
}
/** Journaling/preparation does not advance content. The native FINAL batch fences its current exact head/generation. */
export function journalAuthority(db: MetadataStore, input: WritePermit): PredicateSQL {
  const p = decodeWireSync(Permit)(input);
  if (
    canonical(p.owner) !== canonical(p.target.owner) ||
    p.documentId !== p.target.documentId ||
    p.authorityEpoch < 1 ||
    p.serviceEpoch < 1
  )
    throw invalid();
  return {
    sql: `EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id=? AND step_id=?)
    AND EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=?)`,
    values: [
      db.native(p.owner, p.documentId, p.target.unitId),
      p.authorityEpoch,
      p.operationId,
      p.stepId,
      db.owner(p.owner),
      p.documentId,
      p.target.unitId,
    ],
  };
}
export function validateJournal(p: WritePermit, write: NativeWriteRecord): void {
  if (
    write.operationId !== p.operationId ||
    write.stepId !== p.stepId ||
    write.documentId !== p.documentId ||
    write.unitId !== p.target.unitId ||
    write.generation !== (p.target.scope.kind === "draft" ? p.target.scope.generation : null) ||
    write.worktreeId !== ("worktreeId" in write.receiptKey ? write.receiptKey.worktreeId : null) ||
    write.payload.kind !== "native-write"
  )
    throw invalid();
  contentRevision(write);
}
export function preparedSlot(
  db: MetadataStore,
  owner: OwnerScope,
  write: NativeWriteRecord,
  binding: NativeReceiptBinding,
): PredicateSQL {
  return {
    sql: `EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND command_id=? AND step_id=? AND action=?
    AND write_id=? AND payload_digest=? AND fingerprint=? AND epoch=?)`,
    values: [
      db.native(owner, write.documentId, write.unitId),
      write.operationId,
      write.stepId,
      nativeReceiptAction(write.receiptKey),
      write.id,
      write.payload.digest,
      binding.fingerprint,
      binding.authorityEpoch,
    ],
  };
}
export function acceptedReceipt(
  db: MetadataStore,
  owner: OwnerScope,
  write: NativeWriteRecord,
  binding: NativeReceiptBinding,
): PredicateSQL {
  return {
    sql: `EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=? AND fingerprint=? AND epoch=?)`,
    values: [
      db.native(owner, write.documentId, write.unitId),
      write.operationId,
      write.stepId,
      nativeReceiptAction(write.receiptKey),
      binding.fingerprint,
      binding.authorityEpoch,
    ],
  };
}
