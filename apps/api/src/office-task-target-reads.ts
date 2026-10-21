import { Effect } from "effect";
import type { DraftTarget } from "@starter/office-contract";
import type {
  OfficeMetadata,
  OperationRecord,
  OwnerScope,
  ViewRecord,
} from "@starter/office-server/ports";
import type { OfficeTaskTarget } from "./office-task-target.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

/** Actual owning provider reads, not a caller-asserted View/origin/native grant.
 * Caller has already proved current private callback/fresh51 and bounded same-input records.
 */
export function officeTaskTargetReads(
  metadata: OfficeMetadata,
  owner: OwnerScope,
  operations: readonly OperationRecord[],
) {
  const run = Effect.runPromise;
  const view = async (id: string): Promise<ViewRecord> => {
    const actual = await run(metadata.view(owner, id));
    if (
      actual === null ||
      actual.view.expiresAt <= Date.now() ||
      !officeSame(actual.owner, owner) ||
      !officeSame(actual.target.owner, owner) ||
      actual.view.documentId !== actual.target.documentId
    )
      throw officeDenied();
    const document = await run(metadata.document(owner, actual.target.documentId));
    if (
      document === null ||
      !officeSame(document.owner, owner) ||
      document.unitId !== actual.target.unitId ||
      document.document.id !== actual.view.documentId ||
      document.document.kind !== actual.view.kind
    )
      throw officeDenied();
    const source = actual.source;
    const scope = actual.target.scope;
    if (
      source.kind === "core" &&
      (scope.kind !== "main" || source.revision !== actual.view.revision)
    )
      throw officeDenied();
    if (source.kind === "draft") {
      if (scope.kind !== "draft") throw officeDenied();
      const draft = await run(metadata.draft(owner, scope.draftId));
      if (
        draft === null ||
        !officeSame(draft.owner, owner) ||
        draft.id !== scope.draftId ||
        draft.documentId !== actual.view.documentId ||
        draft.generation < scope.generation ||
        draft.worktreeId !== source.worktreeId ||
        source.revision !== actual.view.revision
      )
        throw officeDenied();
    }
    return actual;
  };
  const draft = async (
    target: DraftTarget,
    readView: ViewRecord | null = null,
  ): Promise<OfficeTaskTarget> => {
    const actual = await run(metadata.draft(owner, target.draftId));
    const document = await run(metadata.document(owner, target.documentId));
    if (
      actual === null ||
      document === null ||
      !officeSame(actual.owner, owner) ||
      !officeSame(document.owner, owner) ||
      actual.id !== target.draftId ||
      document.document.id !== target.documentId ||
      actual.documentId !== target.documentId ||
      actual.generation !== target.generation
    )
      throw officeDenied();
    for (const operation of operations) {
      if (
        operation.receipt.draftId !== actual.id ||
        !["create", "create-draft"].includes(operation.intent.kind)
      )
        continue;
      if (
        actual.originOperationId !== operation.receipt.operationId ||
        actual.worktreeId !== operation.worktreeId ||
        document.unitId !== operation.unitId ||
        (operation.intent.kind === "create" &&
          document.originOperationId !== operation.receipt.operationId)
      )
        throw officeDenied();
    }
    if (
      readView !== null &&
      (readView.source.kind !== "draft" ||
        readView.source.worktreeId !== actual.worktreeId ||
        readView.source.revision !== target.expectedRevision ||
        readView.target.unitId !== document.unitId)
    )
      throw officeDenied();
    return Object.freeze({ target, fork: null, readView });
  };
  return { view, draft };
}
