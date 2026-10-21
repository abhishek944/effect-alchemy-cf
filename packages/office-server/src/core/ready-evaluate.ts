import { decodeWireSync } from "@starter/office-contract";
import type { OfficeDependencies } from "../ports/index.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { prepareSdkSnapshot } from "../storage-remote/producer.ts";
import type { NativeServices } from "./native-services.ts";
import type { ReadyCapture } from "./review-bundle.ts";
import { nativeTypes } from "./target.ts";
import { officeFailure } from "./failure.ts";

/** Owning public SDK computes OT preview. No generated source, replacement snapshot submit or custom merge. */
export async function evaluateReady(
  deps: OfficeDependencies,
  services: NativeServices,
  userID: string,
  capture: ReadyCapture,
): Promise<ReadyCapture> {
  if (capture.removed) throw officeFailure("NOT_EDITABLE");
  const result = await services.drafts.evaluateWorktreeUnitMerge(
    { worktreeID: capture.worktreeId, unitID: capture.unitId },
    { userID },
  );
  if (result.worktreeID !== capture.worktreeId || result.unitID !== capture.unitId)
    throw officeFailure("CONTENT_REQUIRED");
  if (result.status === "preview") {
    const native = decodeWireSync(SnapshotWithBlocksSchema)({
      snapshot: result.preview.snapshot,
      sheetBlocks: [...(result.preview.sheetBlocks ?? [])],
    });
    prepareSdkSnapshot(
      native.snapshot,
      native.sheetBlocks,
      { unitID: capture.unitId, type: nativeTypes[capture.kind], revision: native.snapshot.rev },
      deps.policy.limits.nativeBytes,
    );
    return { ...capture, result: native, state: "complete", fidelity: "snapshot" };
  }
  if (result.status === "not-behind") {
    if (capture.baselineRevision === null || capture.mainRevision !== capture.baselineRevision)
      throw officeFailure("STALE_REVIEW");
    const history = await services.drafts.getChangesets(
      {
        worktreeID: capture.worktreeId,
        unitID: capture.unitId,
        type: nativeTypes[capture.kind],
        from: capture.baselineRevision,
        to: capture.readyRevision,
      },
      { userID },
    );
    if (history.changesets.length > deps.policy.limits.historyScanRevisions)
      throw officeFailure("LIMIT_EXCEEDED");
    let head = capture.baselineRevision;
    for (const change of history.changesets) {
      if (
        change.unitID !== capture.unitId ||
        change.baseRev !== head ||
        change.revision !== head + 1
      )
        throw officeFailure("HISTORY_INCOMPLETE");
      head = change.revision;
    }
    if (head !== capture.readyRevision) throw officeFailure("HISTORY_INCOMPLETE");
    return {
      ...capture,
      result: capture.draft,
      state: "complete",
      fidelity: "history",
      leftChangesets: [],
      rightChangesets: history.changesets,
    };
  }
  if (
    result.status === "not-applicable" &&
    result.reason === "worktree-created-unit" &&
    capture.source === "worktree"
  )
    return { ...capture, result: capture.draft, state: "complete" };
  return {
    ...capture,
    result: null,
    state: result.status === "conflict" ? "conflict" : "incomplete",
  };
}
