import { Id, decodeWireSync } from "@starter/office-contract";
import type { OfficeMetadata, NativeWriteRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict, invalid, missing, storeEffect } from "./store.ts";
import { WriteRow, Permit } from "./schemas.ts";
import { mergeFence } from "./merge-fence.ts";
import { operationRow } from "./operations.ts";
import { documentRow } from "./catalog.ts";
import { artifactEdges, completeRefs } from "./artifacts.ts";
import { writeIdentity, writeRow, journalAuthority, validateJournal } from "./write-context.ts";
import { requirePageProgress } from "./pages.ts";
import { prepareWrite } from "./write-preparation.ts";
import { confirmWrite } from "./write-confirmation.ts";
export function createNativeWrites(
  db: MetadataStore,
): Pick<OfficeMetadata, "stageWrite" | "prepareWrite" | "confirmWrite" | "writes"> {
  return {
    stageWrite: (permit, input) =>
      storeEffect(async () => {
        const write = db.decode(WriteRow, db.encode(WriteRow, input));
        validateJournal(permit, write);
        const authority = journalAuthority(db, permit),
          owner = db.owner(permit.owner);
        if (
          write.phase !== "staged" ||
          write.preparedReceipt !== null ||
          write.acceptedRevision !== null
        )
          throw invalid();
        const previous = await writeRow(db, permit.owner, write.id);
        if (previous) {
          if (
            canonical(writeIdentity(previous)) !== canonical(writeIdentity(write)) ||
            !(await db.first(
              "SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND binding=?",
              [owner, write.id, db.encode(Permit, permit)],
            ))
          )
            throw conflict();
          return previous;
        }
        const operation = await operationRow(db, permit.owner, write.operationId),
          document = await documentRow(db, permit.owner, write.documentId);
        if (!operation || !document) throw missing();
        if (
          operation.documentId !== write.documentId ||
          operation.unitId !== write.unitId ||
          write.nativeType !== { doc: 1, sheet: 2, slide: 3 }[document.document.kind]
        )
          throw invalid();
        const complete = completeRefs(db, permit.owner, [write.payload]);
        let predicate = `${authority.sql} AND ${complete.sql} AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND id=?)
        AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND phase NOT IN ('confirmed','failed-before-submit','conflict','cancelled-before-dispatch'))`;
        const values: (string | number | null)[] = [
          ...authority.values,
          ...complete.values,
          owner,
          write.id,
          owner,
          write.operationId,
        ];
        if (permit.target.scope.kind === "draft") {
          predicate +=
            " AND EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND generation=? AND (? IS NULL OR worktree=?))";
          values.push(
            owner,
            permit.target.scope.draftId,
            write.documentId,
            permit.target.scope.generation,
            write.worktreeId,
            write.worktreeId,
          );
        } else if (write.worktreeId !== null) throw invalid();
        if (operation.intent.kind === "merge") {
          const barrier = mergeFence(db, permit);
          predicate += ` AND (${barrier.sql})`;
          values.push(...barrier.values);
        } else {
          predicate +=
            " AND NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=?)";
          values.push(owner, write.documentId);
        }
        await db.write(predicate, values, [
          [
            "INSERT INTO office_meta_writes(owner,id,operation,document,phase,accepted_revision,record,binding) VALUES(?,?,?,?,?,?,?,?)",
            [
              owner,
              write.id,
              write.operationId,
              write.documentId,
              "staged",
              null,
              db.encode(WriteRow, write),
              db.encode(Permit, permit),
            ],
          ],
          ...artifactEdges(db, permit.owner, "native-write", write.id, [write.payload]),
        ]);
        return write;
      }),
    prepareWrite: (permit, id, binding) => storeEffect(() => prepareWrite(db, permit, id, binding)),
    confirmWrite: (permit, id, revision) =>
      storeEffect(() => confirmWrite(db, permit, id, revision)),
    writes: (owner, id, cursor) =>
      storeEffect(async () => {
        decodeWireSync(Id)(id);
        if (cursor !== null) decodeWireSync(Id)(cursor);
        const rows = await db.all<{ record: string }>(
          "SELECT record FROM office_meta_writes WHERE owner=? AND operation=? AND id>? ORDER BY id LIMIT 100",
          [db.owner(owner), id, cursor ?? ""],
        );
        const items: NativeWriteRecord[] = [];
        let bytes = 0;
        for (const row of rows) {
          bytes += new TextEncoder().encode(row.record).length;
          if (bytes > db.limits.responseBytes) break;
          items.push(db.decode(WriteRow, row.record));
        }
        requirePageProgress(rows.length, items.length);
        return {
          items,
          next:
            items.length < rows.length || rows.length === 100 ? (items.at(-1)?.id ?? null) : null,
        };
      }),
  };
}
