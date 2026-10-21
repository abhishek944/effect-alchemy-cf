import type { IsolatedJob, OperationRecord } from "@starter/office-server/ports";
import { officeSame } from "./office-private-authority.ts";
import { officePrivateDigest } from "./office-private-placement.ts";

/** Immutable identity only, NEVER control/dispatch authority or a current native target grant. */
export async function officeJobControlUnit(
  operation: OperationRecord,
  job: IsolatedJob,
): Promise<boolean> {
  if (job.kind !== "import" || operation.intent.kind !== "import-into")
    return operation.unitId === job.binding.unitId;
  const input = operation.intent.input;
  const binding = job.binding;
  if (
    binding.unitId === operation.unitId ||
    operation.worktreeId === null ||
    operation.receipt.operationId !== binding.operationId ||
    input.target.documentId !== operation.documentId ||
    operation.receipt.draftId !== input.target.draftId ||
    binding.generation !== input.target.generation ||
    binding.kind !== input.options.kind ||
    !officeSame(input.source, job.input) ||
    !officeSame(input.options, job.options) ||
    !officeSame(operation.artifacts.source, job.input) ||
    job.input.kind !== "upload" ||
    binding.inputDigest !== job.input.digest ||
    binding.baseRevision !== null ||
    binding.codeDigest !== null
  )
    return false;
  // EXACT frozen Core/provider tuple. Source Unit is deliberately distinct from destination Unit.
  return (
    binding.unitId ===
    (await officePrivateDigest([
      "office-import-source",
      1,
      operation.owner.stage,
      operation.owner.ownerId,
      operation.receipt.operationId,
      job.input.digest,
    ]))
  );
}
