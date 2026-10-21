import { Id, decodeWireSync } from "@starter/office-contract";
import type { DraftRecord, OfficeMetadata, OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { conflict, invalid, missing, storeEffect } from "./store.ts";
import { discoveryPageBytes, requirePageProgress } from "./pages.ts";
import { DraftRow } from "./schemas.ts";
import { permitSQL } from "./native-fence.ts";
import { eventStatement, operationEvent } from "./events.ts";
export async function draftRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<DraftRecord | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_drafts WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  return row ? db.decode(DraftRow, row.record) : null;
}
export function createDraftCatalog(
  db: MetadataStore,
): Pick<OfficeMetadata, "draft" | "drafts" | "reserveDraft" | "advanceGeneration"> {
  return {
    draft: (owner, id) => storeEffect(() => draftRow(db, owner, id)),
    drafts: (owner, cursor) =>
      storeEffect(async () => {
        if (cursor !== null) decodeWireSync(Id)(cursor);
        const rows = await db.all<{ record: string }>(
          `SELECT m.record FROM office_meta_drafts m
           JOIN office_meta_documents p ON p.owner=m.owner AND p.id=m.document
           JOIN office_native_worktrees w ON w.scope=json_array(?,?,p.id,p.unit)
             AND w.id=m.worktree AND w.generation=m.generation
           JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
           WHERE m.owner=? AND m.id>? ORDER BY m.id LIMIT 100`,
          [owner.stage, owner.ownerId, db.owner(owner), cursor ?? ""],
        );
        const items: DraftRecord[] = [];
        let bytes = 0;
        for (const row of rows) {
          bytes += row.record.length * 3;
          if (bytes > Math.min(db.limits.responseBytes, discoveryPageBytes)) break;
          items.push(db.decode(DraftRow, row.record));
        }
        requirePageProgress(rows.length, items.length);
        return {
          items,
          next:
            items.length < rows.length || rows.length === 100 ? (items.at(-1)?.id ?? null) : null,
        };
      }),
    reserveDraft: (input) =>
      storeEffect(async () => {
        const record = db.decode(DraftRow, db.encode(DraftRow, input));
        const owner = db.owner(record.owner);
        const old = await db.first<{ binding: string; record: string }>(
          "SELECT binding,record FROM office_meta_drafts WHERE owner=? AND id=?",
          [owner, record.id],
        );
        const binding = await db.hash(record);
        if (old) {
          if (old.binding !== binding) throw conflict();
          return db.decode(DraftRow, old.record);
        }
        if (record.generation !== 1) throw invalid();
        await db.write(
          "EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=?) AND NOT EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=?)",
          [owner, record.documentId, owner, record.id],
          [
            [
              "INSERT INTO office_meta_drafts VALUES(?,?,?,?,?,?,?)",
              [
                owner,
                record.id,
                record.documentId,
                record.worktreeId,
                1,
                db.encode(DraftRow, record),
                binding,
              ],
            ],
            eventStatement(db, record.owner, {
              ...operationEvent(record.documentId, record.originOperationId),
              draftId: record.id,
              generation: 1,
              kind: "draft-state",
            }),
          ],
        );
        return record;
      }),
    advanceGeneration: (permit, id, expected) =>
      storeEffect(async () => {
        const record = await draftRow(db, permit.owner, id);
        if (!record) throw missing();
        if (
          permit.target.scope.kind !== "draft" ||
          permit.target.scope.draftId !== id ||
          permit.expectedGeneration !== expected
        )
          throw invalid();
        const scope = db.native(permit.owner, permit.documentId, permit.target.unitId);
        const action = `transition:${record.worktreeId}:${expected}:draft`;
        if (record.generation === expected + 1) {
          if (
            await db.first(
              "SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND action=?",
              [scope, permit.operationId, action],
            )
          )
            return record;
        }
        if (record.generation !== expected) throw conflict("STALE_BASIS");
        const result = { ...record, generation: expected + 1 };
        const fence = permitSQL(db, permit, { generation: expected + 1 });
        await db.write(
          `${fence.sql} AND EXISTS(SELECT 1 FROM office_native_worktrees WHERE scope=? AND id=? AND status='draft')
        AND EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND action=?)
        AND EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND generation=?)`,
          [
            ...fence.values,
            scope,
            record.worktreeId,
            scope,
            permit.operationId,
            action,
            db.owner(permit.owner),
            id,
            expected,
          ],
          [
            [
              "UPDATE office_meta_drafts SET generation=?,record=? WHERE owner=? AND id=?",
              [expected + 1, db.encode(DraftRow, result), db.owner(permit.owner), id],
            ],
            eventStatement(db, permit.owner, {
              ...operationEvent(record.documentId, permit.operationId),
              draftId: id,
              generation: expected + 1,
              kind: "draft-state",
            }),
          ],
          "STALE_BASIS",
        );
        return result;
      }),
  };
}
