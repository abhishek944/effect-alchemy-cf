import { Effect } from "effect";
import {
  OfficeOriginalRequest,
  OfficeOriginalTarget,
  officeAttachmentIds,
  decodeWireSync,
} from "@starter/office-contract";
import type { Target } from "@starter/office-contract";
import type { OwnerScope, Store } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, canonical, conflict, invalid, storeEffect } from "./store.ts";
import { OperationRow } from "./schemas.ts";
import { validateOperation } from "./operation-policy.ts";
import { draftRow } from "./drafts.ts";
import { readOfficeDocumentSources } from "./document-sources.ts";

/** Same Human owner/source discovery as document history, not original task impersonation. */
export function readOfficeOriginalTarget(
  options: OfficeProviderOptions,
  owner: OwnerScope,
  input: typeof OfficeOriginalRequest.Type,
): Store<Target | null> {
  const db = new MetadataStore(options);
  return Effect.gen(function* () {
    const original = yield* storeEffect(async () => {
      const selected = decodeWireSync(OfficeOriginalRequest)(input);
      const id = officeAttachmentIds(selected.fileRef).operationId;
      const row = await db.first<{ record: string }>(
        "SELECT record FROM office_meta_operations WHERE owner=? AND id=? AND phase='confirmed'",
        [db.owner(owner), id],
      );
      if (row === null) return null;
      const operation = db.decode(OperationRow, row.record);
      validateOperation(operation);
      // Human imports retain their existing Human receipt path; unknown imports are not promoted.
      if (operation.actor.capability !== "draft-task" || operation.intent.kind !== "create")
        return null;
      const source = operation.actor.sourceFile;
      if (!source || source.chatId !== selected.chatId || source.fileRef !== selected.fileRef)
        throw invalid();
      return { id, operation, selected };
    });
    if (original === null) return null;
    const { id, operation, selected } = original;
    const links = yield* readOfficeDocumentSources(options, owner, operation.documentId, null, id);
    const link = links.items[0];
    if (
      links.items.length !== 1 ||
      link?.operationId !== id ||
      links.next !== null ||
      link.chatId !== selected.chatId ||
      link.fileRef !== selected.fileRef
    )
      return yield* Effect.fail(invalid());
    return yield* storeEffect(async () => {
      const draft = await draftRow(db, owner, link.draftId);
      if (
        !draft ||
        draft.id !== link.draftId ||
        canonical(draft.owner) !== canonical(owner) ||
        draft.documentId !== link.documentId ||
        draft.originOperationId !== id ||
        draft.worktreeId !== operation.worktreeId ||
        draft.generation < link.generation
      )
        throw conflict("STALE_BASIS");
      return decodeWireSync(OfficeOriginalTarget)({
        documentId: link.documentId,
        scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
      });
    });
  });
}
