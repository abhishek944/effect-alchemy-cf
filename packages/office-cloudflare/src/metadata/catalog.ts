import { Id, decodeWireSync } from "@starter/office-contract";
import type { DocumentRecord, OfficeMetadata, OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { conflict, invalid, missing, storeEffect } from "./store.ts";
import { discoveryPageBytes, requirePageProgress } from "./pages.ts";
import { DocumentRow } from "./schemas.ts";
import { permitSQL } from "./native-fence.ts";
import { eventStatement, operationEvent } from "./events.ts";

export async function documentRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<DocumentRecord | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_documents WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  if (!row) return null;
  const record = db.decode(DocumentRow, row.record);
  if (record.location !== "main") return record;
  const unit = await db.first<{ head: number }>(
    "SELECT head FROM office_native_units WHERE scope=? AND lifecycle='active'",
    [db.native(owner, id, record.unitId)],
  );
  return { ...record, document: { ...record.document, revision: unit?.head ?? null } };
}
export function createCatalog(
  db: MetadataStore,
): Pick<OfficeMetadata, "document" | "documents" | "reserveDocument" | "publishDocument"> {
  return {
    document: (owner, id) => storeEffect(() => documentRow(db, owner, id)),
    documents: (owner, cursor) =>
      storeEffect(async () => {
        if (cursor !== null) decodeWireSync(Id)(cursor);
        const rows = await db.all<{ id: string; record: string }>(
          "SELECT id,record FROM office_meta_documents WHERE owner=? AND id>? ORDER BY id LIMIT 100",
          [db.owner(owner), cursor ?? ""],
        );
        const items: DocumentRecord[] = [];
        let bytes = 0;
        for (const row of rows) {
          bytes += row.record.length * 3;
          if (bytes > Math.min(db.limits.responseBytes, discoveryPageBytes)) break;
          const value = await documentRow(db, owner, row.id);
          if (value) items.push(value);
        }
        requirePageProgress(rows.length, items.length);
        return {
          items,
          next:
            items.length < rows.length || rows.length === 100
              ? (items.at(-1)?.document.id ?? null)
              : null,
        };
      }),
    reserveDocument: (input) =>
      storeEffect(async () => {
        const record = db.decode(DocumentRow, db.encode(DocumentRow, input));
        const owner = db.owner(record.owner);
        const old = await db.first<{ binding: string; record: string }>(
          "SELECT binding,record FROM office_meta_documents WHERE owner=? AND id=?",
          [owner, record.document.id],
        );
        const binding = await db.hash(record);
        if (old) {
          if (old.binding !== binding) throw conflict();
          return db.decode(DocumentRow, old.record);
        }
        if (
          record.location === "main" ||
          record.document.revision !== null ||
          (record.location === "draft") !== (record.document.draftId !== null)
        )
          throw invalid();
        await db.write(
          "NOT EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=?)",
          [owner, record.document.id],
          [
            [
              "INSERT INTO office_meta_documents(owner,id,unit,record,binding) VALUES(?,?,?,?,?)",
              [owner, record.document.id, record.unitId, db.encode(DocumentRow, record), binding],
            ],
            eventStatement(
              db,
              record.owner,
              operationEvent(record.document.id, record.originOperationId),
            ),
          ],
        );
        return record;
      }),
    publishDocument: (permit) =>
      storeEffect(async () => {
        const record = await documentRow(db, permit.owner, permit.documentId);
        if (!record) throw missing();
        if (permit.target.scope.kind !== "main" || record.originOperationId !== permit.operationId)
          throw invalid();
        if (record.location === "main") return record;
        if (record.location !== "reserved-main") throw conflict();
        const fence = permitSQL(db, permit, { head: 1 });
        const scope = db.native(permit.owner, permit.documentId, record.unitId);
        const result: DocumentRecord = {
          ...record,
          location: "main",
          document: { ...record.document, revision: 1, draftId: null },
        };
        await db.write(
          `${fence.sql} AND EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND action='create-main')`,
          [...fence.values, scope, permit.operationId],
          [
            [
              "UPDATE office_meta_documents SET record=? WHERE owner=? AND id=?",
              [db.encode(DocumentRow, result), db.owner(permit.owner), permit.documentId],
            ],
            eventStatement(db, permit.owner, {
              ...operationEvent(permit.documentId, permit.operationId),
              revision: 1,
              kind: "revision-confirmed",
            }),
          ],
          "AUTHORITY_LOST",
        );
        return result;
      }),
  };
}
