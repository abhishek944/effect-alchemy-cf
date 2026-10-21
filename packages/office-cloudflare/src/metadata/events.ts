import { Count, DocumentEvent, Id, decodeWireSync } from "@starter/office-contract";
import type { OwnerScope, OfficeMetadata } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { canonical, missing, storeEffect } from "./store.ts";
import { requirePageProgress } from "./pages.ts";
import { DocumentRow } from "./schemas.ts";

type EventBody = Omit<DocumentEvent, "sequence">;
export function eventStatement(db: MetadataStore, owner: OwnerScope, body: EventBody): Statement {
  const event = decodeWireSync(DocumentEvent)({ ...body, sequence: 0 });
  const { sequence: _sequence, ...stored } = event;
  return [
    "INSERT INTO office_meta_events(owner,document,record) VALUES(?,?,?)",
    [db.owner(owner), body.documentId, canonical(stored)],
  ];
}
export const operationEvent = (documentId: string, operationId: string): EventBody => ({
  documentId,
  draftId: null,
  generation: 0,
  revision: null,
  operationId,
  kind: "operation-state",
});
export function createEvents(db: MetadataStore): Pick<OfficeMetadata, "events"> {
  return {
    events: (owner, documentId, after) =>
      storeEffect(async () => {
        decodeWireSync(Id)(documentId);
        decodeWireSync(Count)(after);
        const key = db.owner(owner);
        const document = await db.first<{ record: string }>(
          "SELECT record FROM office_meta_documents WHERE owner=? AND id=?",
          [key, documentId],
        );
        if (!document) throw missing();
        const record = db.decode(DocumentRow, document.record);
        const native = db.native(owner, documentId, record.unitId);
        const pending = await db.all<{ sequence: number; command_id: string }>(
          `SELECT n.sequence,n.command_id FROM office_native_outbox n WHERE n.scope=? AND NOT EXISTS(
       SELECT 1 FROM office_meta_events e WHERE e.owner=? AND e.document=? AND e.native_sequence=n.sequence)
       ORDER BY n.sequence LIMIT 100`,
          [native, key, documentId],
        );
        if (pending.length) {
          // A refresh invalidation, not a fabricated historical revision/vector or SDK frame.
          const statements: Statement[] = pending.map((row) => [
            `INSERT OR IGNORE INTO office_meta_events(owner,document,record,native_sequence)
         SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM office_native_outbox WHERE scope=? AND sequence=?)`,
            [
              key,
              documentId,
              canonical({
                documentId,
                draftId: null,
                generation: 0,
                revision: null,
                operationId: null,
                kind: "authority-changed",
              }),
              row.sequence,
              native,
              row.sequence,
            ],
          ]);
          await db.write("1", [], statements);
        }
        const rows = await db.all<{ sequence: number; record: string }>(
          "SELECT sequence,json_set(record,'$.sequence',sequence) AS record FROM office_meta_events WHERE owner=? AND document=? AND sequence>? ORDER BY sequence LIMIT 101",
          [key, documentId, after],
        );
        const items: DocumentEvent[] = [];
        let bytes = 0;
        for (const row of rows.slice(0, 100)) {
          bytes += new TextEncoder().encode(row.record).length;
          if (bytes > db.limits.responseBytes) break;
          const event = db.decode(DocumentEvent, row.record);
          items.push(event);
        }
        requirePageProgress(rows.length, items.length);
        const last = items.at(-1)?.sequence;
        return {
          items,
          next: rows.length > items.length && last !== undefined ? String(last) : null,
        };
      }),
  };
}
