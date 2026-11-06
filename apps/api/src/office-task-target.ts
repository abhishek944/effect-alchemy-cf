import type { DraftTarget, OfficeSourceDescriptor, Target } from "@highchat/office-contract";
import type { OfficeMetadata, OperationRecord, ViewRecord } from "@highchat/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { officeTaskTargetReads } from "./office-task-target-reads.ts";
import { readOfficeTaskDiscovery, type OfficeTaskDiscovery } from "./office-task-descriptor.ts";
import type { OfficeTaskAttachment } from "./office-task-attachment.ts";
import type { OfficeTaskReview } from "./office-task-review.ts";
import { officeSourceBasis, officeSourceTarget } from "./office-task-source.ts";

export type OfficeTaskTarget = {
  readonly target: DraftTarget | null;
  readonly fork: ViewRecord | null;
  readonly readView: ViewRecord | null;
  readonly source?: OfficeSourceDescriptor | null;
  readonly selected?: Target;
  readonly review?: OfficeTaskReview;
  readonly discovery?: OfficeTaskDiscovery;
  readonly attachment?: OfficeTaskAttachment | null;
  readonly referenceBasis?: DraftTarget;
};
const empty: OfficeTaskTarget = Object.freeze({ target: null, fork: null, readView: null });

/** Root resolves the explicit document/branch; revision is captured by a fresh native open. */
export async function resolveOfficeTaskTarget(
  metadata: OfficeMetadata,
  proof: OfficeTaskProof,
  operations: readonly OperationRecord[],
  source: OfficeSourceDescriptor | null,
): Promise<OfficeTaskTarget> {
  const { session, intent } = proof.association;
  const owner = { stage: session.stage, ownerId: session.ownerId };
  const { view, draft } = officeTaskTargetReads(metadata, owner, operations);
  const command = intent.command;
  const selected = () => {
    if (source === null) throw officeDenied();
    return officeSourceTarget(source, proof);
  };
  const basis = () => {
    if (source === null || intent.worktreeId === undefined) throw officeDenied();
    return officeSourceBasis(source, proof);
  };
  const main = async () => {
    const target = selected();
    const captured = intent.mainView;
    if (
      target.scope.kind !== "main" ||
      captured?.kind !== "main" ||
      captured.documentId !== target.documentId
    )
      throw officeDenied();
    const checked = await view(captured.viewId);
    if (
      checked.target.scope.kind !== "main" ||
      checked.source.kind !== "core" ||
      checked.view.documentId !== target.documentId ||
      checked.view.revision !== captured.expectedRevision ||
      checked.source.revision !== captured.expectedRevision
    )
      throw officeDenied();
    return checked;
  };
  switch (command.command) {
    case "create-draft": {
      const fork = await main();
      if (command.input.documentId !== fork.view.documentId) throw officeDenied();
      return { ...empty, fork };
    }
    case "open": {
      const target = selected();
      if (!officeSame(command.input, target)) throw officeDenied();
      return target.scope.kind === "main"
        ? { ...empty, selected: target }
        : { ...(await draft(basis())), selected: target };
    }
    case "execute":
    case "import-into": {
      const target = basis();
      if (intent.basis === undefined || !officeSame(command.input.target, target))
        throw officeDenied();
      return draft(target);
    }
    case "ready":
    case "reopen":
    case "discard": {
      const target = basis();
      if (
        command.input.draftId !== target.draftId ||
        command.input.generation !== target.generation ||
        intent.basis === undefined
      )
        throw officeDenied();
      return draft(target);
    }
    case "inspect":
    case "render":
    case "export": {
      const target = selected();
      const readView = await view(command.input.viewId);
      if (
        !officeSame(readView.target.scope, target.scope) ||
        readView.view.documentId !== target.documentId
      )
        throw officeDenied();
      if (target.scope.kind === "main") {
        if (!officeSame(await main(), readView)) throw officeDenied();
        return { ...empty, readView };
      }
      const bound = basis();
      if (intent.basis === undefined || readView.view.revision !== bound.expectedRevision)
        throw officeDenied();
      return draft(bound, readView);
    }
    case "draft": {
      const target = basis();
      if (command.draftId !== target.draftId) throw officeDenied();
      return {
        ...empty,
        discovery: await readOfficeTaskDiscovery(metadata, owner, { draftId: target.draftId }),
      };
    }
    case "drafts":
      if (source === null) throw officeDenied();
      return {
        ...empty,
        discovery: await readOfficeTaskDiscovery(metadata, owner, { cursor: command.cursor }),
      };
    case "review":
      throw officeDenied(); // Review/publish remains the existing Human UI, not an AI command.
    default:
      return empty; // Import staging/creation/receipt has no native target grant.
  }
}
