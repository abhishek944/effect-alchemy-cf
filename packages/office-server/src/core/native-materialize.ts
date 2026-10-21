import {
  UnitSnapshotMaterializer,
  type UnitLoadDataWithBlocks,
} from "@univerjs-pro/collaboration-service";
import type { ISheetBlock } from "@univerjs/protocol";
import type { Kind, OfficeLimits } from "@starter/office-contract";
import { JOB_NATIVE_LIMITS, snapshotDigest } from "../jobs/frames.ts";
import { nativeTypes } from "./target.ts";
import { officeFailure } from "./failure.ts";
import type { NativeServices } from "./native-services.ts";
export type NativeLoadPreflight = (input: UnitLoadDataWithBlocks) => void;

/** Reuses an already acquired SDK invocation, including Ready Worktree → current trunk reads. */
export async function materializeRevision(
  services: NativeServices,
  ownerId: string,
  unitId: string,
  worktreeId: string | null,
  kind: Kind,
  revision: number,
  limits: OfficeLimits,
  preflight?: NativeLoadPreflight,
) {
  const type = nativeTypes[kind];
  const context = { userID: ownerId };
  const read = { unitID: unitId, type, revision };
  const loaded =
    worktreeId === null
      ? await services.core.getUnitLoadData(read, context)
      : await services.drafts.getUnitLoadData({ ...read, worktreeID: worktreeId }, context);
  if (
    loaded.targetRevision !== revision ||
    loaded.snapshot.unitID !== read.unitID ||
    loaded.snapshot.type !== type ||
    loaded.snapshot.rev > revision ||
    loaded.changesets.length > limits.historyScanRevisions
  )
    throw officeFailure("HISTORY_INCOMPLETE");
  let head = loaded.snapshot.rev;
  for (const change of loaded.changesets) {
    if (
      change.unitID !== read.unitID ||
      change.type !== type ||
      change.baseRev !== head ||
      change.revision !== head + 1
    )
      throw officeFailure("HISTORY_INCOMPLETE");
    head = change.revision;
  }
  if (head !== revision) throw officeFailure("HISTORY_INCOMPLETE");
  const ids = Object.values(loaded.snapshot.workbook?.blockMeta ?? {}).flatMap(
    (group) => group.blocks,
  );
  if (ids.length > limits.blockCount || new Set(ids).size !== ids.length)
    throw officeFailure("LIMIT_EXCEEDED");
  const sheetBlocks: ISheetBlock[] = [];
  let bytes = 0;
  for (const blockID of ids) {
    const input = { unitID: read.unitID, type, blockID };
    const result =
      worktreeId === null
        ? await services.core.getSheetBlock(input, context)
        : await services.drafts.getSheetBlock({ ...input, worktreeID: worktreeId }, context);
    if (result.block === null || result.block.id !== blockID)
      throw officeFailure("CONTENT_REQUIRED");
    bytes += result.block.data.byteLength;
    if (result.block.data.byteLength > limits.blockBytes || bytes > JOB_NATIVE_LIMITS.maxBytes)
      throw officeFailure("LIMIT_EXCEEDED");
    sheetBlocks.push(result.block);
  }
  const input: UnitLoadDataWithBlocks = { ...loaded, sheetBlocks };
  preflight?.(input); // Import admission must run before any coordinate-driven SDK model load.
  const materializer = new UnitSnapshotMaterializer();
  try {
    const native = await materializer.materializeSnapshot(input);
    if (
      native.snapshot.unitID !== read.unitID ||
      native.snapshot.rev !== revision ||
      native.snapshot.type !== type
    )
      throw officeFailure("HISTORY_INCOMPLETE");
    snapshotDigest(native);
    return native;
  } finally {
    await materializer.dispose();
  }
}
