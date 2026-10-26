import type { DraftTarget } from "@starter/office-contract";
import type { OperationRecord } from "@starter/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { confirmedOfficeTaskTargets } from "./office-task-lineage.ts";
import { officeDenied } from "./office-private-authority.ts";

/** Descriptor only: one branch proved by this accepted input, never a latest account draft. */
export function officeReferenceBasis(
  proof: OfficeTaskProof,
  operations: readonly OperationRecord[],
): DraftTarget | undefined {
  const captured = proof.association.reference;
  if (captured?.kind !== "native" || captured.target.kind !== "main") return undefined;
  const targets = confirmedOfficeTaskTargets(proof, operations).filter(
    (target) => target.documentId === captured.target.documentId,
  );
  const branches = new Set(
    targets.map((target) => JSON.stringify([target.draftId, target.generation])),
  );
  if (branches.size > 1) throw officeDenied();
  return targets.toSorted((a, b) => b.expectedRevision - a.expectedRevision)[0];
}
