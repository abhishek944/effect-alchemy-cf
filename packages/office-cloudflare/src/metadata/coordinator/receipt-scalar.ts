import { Revision, decodeWireSync } from "@starter/office-contract";
import type { NativeWriteRecord, OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { conflict } from "../store.ts";
import { nativeReceiptAction } from "../native-actions.ts";
import { readValueHeader } from "../../native/value-headers.ts";

type Association = {
  write_id: string;
  payload_digest: string;
  fingerprint: string;
  original_epoch: number;
  value_hash: string;
  kind: string | null;
  header: string | null;
};
function checkedRevision(write: NativeWriteRecord, revision: number): number {
  const accepted = decodeWireSync(Revision)(revision),
    key = write.receiptKey;
  if (
    (write.kind === "create-unit" && key.kind !== "create-main" && key.kind !== "create-draft") ||
    (write.kind === "changeset" && key.kind !== "main-change" && key.kind !== "draft-change") ||
    (write.kind === "snapshot" && key.kind !== "snapshot")
  )
    throw conflict();
  if (
    (key.kind === "main-change" || key.kind === "draft-change" || key.kind === "snapshot") &&
    key.revision !== accepted
  )
    throw conflict();
  return accepted;
}
/** Called only AFTER exact original journal/slot/receipt proof; never a body read or latest-head lookup. */
export async function originalScalar(
  db: MetadataStore,
  owner: OwnerScope,
  write: NativeWriteRecord,
): Promise<{ proven: true; revision: number | null } | { proven: false }> {
  if (write.kind === "lifecycle") {
    if (
      write.acceptedRevision !== null ||
      ["create-main", "create-draft", "main-change", "draft-change", "snapshot"].includes(
        write.receiptKey.kind,
      )
    )
      throw conflict();
    return { proven: true, revision: null };
  }
  const row = await db.first<Association>(
    `SELECT h.write_id,h.payload_digest,h.fingerprint,h.original_epoch,h.value_hash,v.kind,v.header
      FROM office_coord_accepted_headers h LEFT JOIN office_native_values v ON v.scope=h.scope AND v.value_hash=h.value_hash
      WHERE h.scope=? AND h.command_id=? AND h.step_id=? AND h.action=?`,
    [
      db.native(owner, write.documentId, write.unitId),
      write.operationId,
      write.stepId,
      nativeReceiptAction(write.receiptKey),
    ],
  );
  if (!row) {
    // Legacy schema2 accepted scalars are usable only with the caller's already-proved exact OLD slot/receipt.
    return write.phase === "confirmed" && write.acceptedRevision !== null
      ? { proven: true, revision: checkedRevision(write, write.acceptedRevision) }
      : { proven: false };
  }
  const binding = write.preparedReceipt;
  if (
    !binding ||
    row.write_id !== write.id ||
    row.payload_digest !== write.payload.digest ||
    row.fingerprint !== binding.fingerprint ||
    row.original_epoch !== binding.authorityEpoch
  )
    throw conflict();
  if (!row.header || !row.kind) return { proven: false };
  if (new TextEncoder().encode(row.header).byteLength > 4096) throw conflict("CONTENT_REQUIRED");
  let header;
  try {
    header = readValueHeader(JSON.parse(row.header));
  } catch {
    throw conflict("CONTENT_REQUIRED");
  }
  if (header.kind === "block") throw conflict();
  const nativeType: number = header.type;
  if (
    header.kind !== row.kind ||
    header.unitID !== write.unitId ||
    nativeType !== write.nativeType ||
    (write.kind === "changeset") !== (header.kind === "changeset")
  )
    throw conflict();
  const revision = checkedRevision(write, header.revision);
  if (
    header.kind === "changeset" &&
    (header.baseRev !== write.baseRevision ||
      header.revision !== header.baseRev + 1 ||
      header.sid !== write.sid ||
      header.reqId !== write.reqId)
  )
    throw conflict();
  if (
    write.phase === "confirmed" &&
    write.acceptedRevision !== null &&
    write.acceptedRevision !== revision
  )
    throw conflict();
  return { proven: true, revision };
}
