import type { DraftTarget } from "@starter/office-contract";
import type { OfficeMetadata, OperationRecord, ViewRecord } from "@starter/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { confirmedOfficeTaskTargets } from "./office-task-lineage.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { officeTaskTargetReads } from "./office-task-target-reads.ts";
import { Effect } from "effect";
import { readOfficeTaskReview, type OfficeTaskReview } from "./office-task-review.ts";
import { readOfficeTaskDiscovery, type OfficeTaskDiscovery } from "./office-task-descriptor.ts";
import type { OfficeTaskAttachment } from "./office-task-attachment.ts";

export type OfficeTaskTarget = {
  readonly target: DraftTarget | null;
  readonly fork: ViewRecord | null;
  readonly readView: ViewRecord | null;
  readonly review?: OfficeTaskReview;
  readonly discovery?: OfficeTaskDiscovery;
  readonly attachment?: OfficeTaskAttachment | null;
  /** Descriptor only for a branch confirmed by this accepted input; never an actor target grant. */
  readonly referenceBasis?: DraftTarget;
};
const empty: OfficeTaskTarget = Object.freeze({ target: null, fork: null, readView: null });

/** Root caller first proves actual private callback/fresh51; this selects metadata, not authority. */
export async function resolveOfficeTaskTarget(
  metadata: OfficeMetadata,
  proof: OfficeTaskProof,
  operations: readonly OperationRecord[],
  attachment: OfficeTaskAttachment | null = null,
): Promise<OfficeTaskTarget> {
  const { session, target: captured, intent } = proof.association;
  const owner = { stage: session.stage, ownerId: session.ownerId };
  const run = Effect.runPromise;
  const targets = [...confirmedOfficeTaskTargets(proof, operations)];
  if (attachment?.target) targets.push(attachment.target);
  const command = intent.command;
  const { view, draft } = officeTaskTargetReads(metadata, owner, operations);
  let original: Promise<ViewRecord> | undefined;
  const capturedView = () =>
    (original ??= (async () => {
      if (captured === null) throw officeDenied();
      const checked = await view(captured.viewId);
      const scope = checked.target.scope;
      if (
        checked.view.documentId !== captured.documentId ||
        checked.view.kind !== captured.documentKind ||
        checked.view.revision !== captured.expectedRevision ||
        scope.kind !== captured.kind ||
        (captured.kind === "draft" &&
          (scope.kind !== "draft" ||
            scope.draftId !== captured.draftId ||
            scope.generation !== captured.generation))
      )
        throw officeDenied();
      return checked;
    })());
  const seedOriginalDraft = async () => {
    if (captured?.kind !== "draft") return;
    const checked = await capturedView();
    if (checked.source.kind !== "draft" || checked.source.revision !== captured.expectedRevision)
      throw officeDenied();
    targets.push(
      Object.freeze({
        documentId: captured.documentId,
        draftId: captured.draftId,
        generation: captured.generation,
        expectedRevision: captured.expectedRevision,
      }),
    );
  };
  const choose = async (id: string, generation: number, documentId?: string, revision?: number) => {
    const find = () =>
      targets
        .filter(
          (target) =>
            target.draftId === id &&
            target.generation === generation &&
            (documentId === undefined || target.documentId === documentId) &&
            (revision === undefined || target.expectedRevision === revision),
        )
        .toSorted((a, b) => b.expectedRevision - a.expectedRevision)[0];
    const own = find();
    if (own !== undefined) return own;
    await seedOriginalDraft();
    const selected = find();
    if (selected === undefined) throw officeDenied();
    return selected;
  };
  const main = async () => {
    const checked = await capturedView();
    if (
      captured?.kind !== "main" ||
      checked.source.kind !== "core" ||
      checked.source.revision !== captured.expectedRevision
    )
      throw officeDenied();
    return checked;
  };
  switch (command.command) {
    case "create-draft": {
      const fork = await main();
      if (command.input.documentId !== fork.view.documentId) throw officeDenied();
      return Object.freeze({ target: null, fork, readView: null });
    }
    case "open": {
      const input = command.input;
      if (input.scope.kind === "main") {
        const readView = await main();
        if (input.documentId !== readView.view.documentId) throw officeDenied();
        return Object.freeze({ target: null, fork: null, readView });
      }
      return draft(await choose(input.scope.draftId, input.scope.generation, input.documentId));
    }
    case "execute":
    case "import-into": {
      const target = command.input.target;
      return draft(
        await choose(target.draftId, target.generation, target.documentId, target.expectedRevision),
      );
    }
    case "ready":
    case "reopen":
    case "discard":
      return draft(await choose(command.input.draftId, command.input.generation));
    case "inspect":
    case "render":
    case "export": {
      const readView = await view(command.input.viewId);
      if (captured?.viewId === readView.view.id && officeSame(await capturedView(), readView)) {
        if (readView.source.kind === "artifact")
          return Object.freeze({ target: null, fork: null, readView });
        if (readView.target.scope.kind === "main")
          return Object.freeze({ target: null, fork: null, readView });
      }
      const scope = readView.target.scope;
      if (scope.kind !== "draft") throw officeDenied();
      return draft(
        await choose(
          scope.draftId,
          scope.generation,
          readView.view.documentId,
          readView.view.revision,
        ),
        readView,
      );
    }
    case "review": {
      const review = await run(metadata.review(owner, command.reviewId));
      if (review === null || !officeSame(review.owner, owner) || review.expiresAt <= Date.now())
        throw officeDenied();
      if (
        !targets.some(
          (candidate) =>
            candidate.documentId === review.documentId &&
            candidate.generation === review.generation &&
            candidate.expectedRevision === review.draftRevision,
        )
      )
        await seedOriginalDraft();
      for (const candidate of targets) {
        if (
          candidate.documentId !== review.documentId ||
          candidate.generation !== review.generation ||
          candidate.expectedRevision !== review.draftRevision
        )
          continue;
        const actual = await run(metadata.draft(owner, candidate.draftId));
        if (actual?.worktreeId === review.worktreeId)
          return Object.freeze({
            ...(await draft(candidate)),
            review: await readOfficeTaskReview(metadata, review, candidate),
          });
      }
      throw officeDenied();
    }
    case "draft":
      return Object.freeze({
        ...empty,
        discovery: await readOfficeTaskDiscovery(metadata, owner, { draftId: command.draftId }),
      });
    case "drafts":
      return Object.freeze({
        ...empty,
        discovery: await readOfficeTaskDiscovery(metadata, owner, { cursor: command.cursor }),
      });
    default:
      return empty; // Discovery/staging/new document/receipt has NO native target grant.
  }
}
