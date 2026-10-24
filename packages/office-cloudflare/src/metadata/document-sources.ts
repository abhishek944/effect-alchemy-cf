import { Schema } from "effect";
import { Id, OfficeSourceLink, OfficeSourcePage, decodeWireSync } from "@starter/office-contract";
import type { OwnerScope, Store } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, canonical, invalid, storeEffect } from "./store.ts";
import { DocumentRow, OperationRow } from "./schemas.ts";
import { validateOperation } from "./operation-policy.ts";
import { discoveryPageBytes, requirePageProgress } from "./pages.ts";

const Position = Schema.Tuple([Id, Id]);

/** Descriptive confirmed import history only. Caller owns genuine Human session authentication. */
export function readOfficeDocumentSources(
  options: OfficeProviderOptions,
  owner: OwnerScope,
  documentId: string,
  cursor: string | null,
  operationId: string | null = null,
): Store<OfficeSourcePage> {
  const db = new MetadataStore(options);
  return storeEffect(async () => {
    const id = decodeWireSync(Id)(documentId);
    if (operationId !== null) decodeWireSync(Id)(operationId);
    let after = "";
    if (cursor !== null) {
      const position = decodeWireSync(Position)(JSON.parse(cursor));
      if (position[0] !== id) throw invalid();
      after = position[1];
    }
    const scope = db.owner(owner);
    const document = await db.first<{ record: string }>(
      "SELECT record FROM office_meta_documents WHERE owner=? AND id=?",
      [scope, id],
    );
    if (document === null) throw invalid();
    const doc = db.decode(DocumentRow, document.record);
    if (doc.document.id !== id || canonical(doc.owner) !== canonical(owner)) throw invalid();
    const rows = await db.all<{ id: string; record: string }>(
      `SELECT id,record FROM office_meta_operations WHERE owner=? AND document=?
       AND phase='confirmed' AND id>? AND (? IS NULL OR id=?)
       AND json_extract(record,'$.actor.capability')='draft-task'
       AND json_extract(record,'$.actor.sourceFile') IS NOT NULL
       AND json_extract(record,'$.intent.kind') IN ('create','import-into')
       ORDER BY id LIMIT 21`,
      [scope, id, after, operationId, operationId],
    );
    const items: OfficeSourceLink[] = [];
    let bytes = 512;
    for (const row of rows) {
      const operation = db.decode(OperationRow, row.record);
      validateOperation(operation);
      const actor = operation.actor;
      const source = actor.capability === "draft-task" ? actor.sourceFile : undefined;
      const intent = operation.intent;
      const uploadId =
        intent.kind === "create" && intent.input.source.kind === "office"
          ? intent.input.source.uploadId
          : intent.kind === "import-into"
            ? intent.input.source.id
            : null;
      const generation =
        intent.kind === "create"
          ? 1
          : intent.kind === "import-into"
            ? intent.input.target.generation
            : null;
      if (
        source === undefined ||
        uploadId === null ||
        generation === null ||
        canonical(operation.owner) !== canonical(owner) ||
        canonical(actor.owner) !== canonical(owner) ||
        actor.principalId !== owner.ownerId ||
        operation.documentId !== id ||
        operation.unitId !== doc.unitId ||
        operation.receipt.documentId !== id ||
        operation.receipt.operationId !== row.id ||
        operation.receipt.phase !== "confirmed" ||
        operation.receipt.kind !== intent.kind ||
        operation.receipt.draftId === null ||
        operation.worktreeId === null ||
        uploadId !== source.upload.id ||
        canonical(operation.artifacts.source) !== canonical(source.upload) ||
        (intent.kind === "create" && intent.input.destination !== "new-draft") ||
        (intent.kind === "import-into" &&
          canonical(intent.input.source) !== canonical(source.upload))
      )
        throw invalid();
      const link = decodeWireSync(OfficeSourceLink)({
        operationId: row.id,
        uploadId,
        documentId: id,
        draftId: operation.receipt.draftId,
        generation,
        chatId: source.chatId,
        fileRef: source.fileRef,
        name: source.name,
      });
      const size = new TextEncoder().encode(JSON.stringify(link)).byteLength + 1;
      if (items.length === 20 || bytes + size > discoveryPageBytes) break;
      items.push(link);
      bytes += size;
    }
    requirePageProgress(rows.length, items.length);
    return decodeWireSync(OfficeSourcePage)({
      items,
      next:
        rows.length > items.length
          ? JSON.stringify([id, items[items.length - 1]?.operationId])
          : null,
    });
  });
}
