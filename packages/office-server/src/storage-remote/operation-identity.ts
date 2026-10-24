/**
 * Fixed persisted identity tuple layout shared by Core and the Worker pre-reservation proof.
 * Worker-safe by design: no Node hashing, SDK runtime or authority grant. Each side hashes the
 * same bytes with its own adapter, and a digest is never authentication.
 */
export const mergeIntentTuple = (operationId: string, approvalOperationId: string) =>
  ["office-intent", 1, "merge", operationId, approvalOperationId] as const;

export const operationTuple = (
  intent: readonly unknown[],
  documentId: string,
  unitId: string,
  worktreeId: string | null,
  policyVersion: string,
) => ["office-operation", 1, intent, documentId, unitId, worktreeId, policyVersion] as const;

/** First pre-reservation merge: exact bytes of the operation Core later persists. */
export const mergeOperationTuple = (
  operationId: string,
  approvalOperationId: string,
  target: { readonly documentId: string; readonly unitId: string },
  worktreeId: string,
  policyVersion: string,
) =>
  operationTuple(
    mergeIntentTuple(operationId, approvalOperationId),
    target.documentId,
    target.unitId,
    worktreeId,
    policyVersion,
  );
