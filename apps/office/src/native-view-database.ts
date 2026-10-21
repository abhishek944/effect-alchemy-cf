import type {
  IDatabaseAdapter,
  ISnapshotWithBlocks,
  UnitRecord,
} from "@univerjs-pro/collaboration-service";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { HostUnitRecord, HostSnapshotInfo } from "@starter/office-server/native-remote";
import { decodeWireSync } from "@starter/office-contract";

const denied = (): never => {
  throw new OfficeForbidden(safeFailure("FORBIDDEN"));
};

/** A REAL immutable artifact adapter. Its head is the actual preview revision, NOT a publication claim. */
export function createViewSnapshotDatabase(
  native: ISnapshotWithBlocks,
  original: UnitRecord,
  userId: string,
  check: () => void,
): IDatabaseAdapter {
  const source = decodeWireSync(HostUnitRecord)(structuredClone(original));
  const snapshot = native.snapshot;
  const header = decodeWireSync(HostSnapshotInfo)({
    unitID: snapshot.unitID,
    type: snapshot.type,
    rev: snapshot.rev,
  });
  if (source.unitID !== header.unitID || source.type !== header.type)
    throw new OfficeForbidden(safeFailure("FORBIDDEN"));
  const blocks = new Map(native.sheetBlocks.map((block) => [block.id, block]));
  const guard = (owner: string, unitId: string) => {
    check();
    if (owner !== userId || unitId !== snapshot.unitID) denied();
  };
  const available = (revision: number | undefined) =>
    revision === undefined || revision >= snapshot.rev;
  return {
    async getUnit(context, unitID) {
      guard(context.userID, unitID);
      return { ...source, headRevision: snapshot.rev };
    },
    async getSnapshotInfo(context, unitID, options) {
      guard(context.userID, unitID);
      return available(options?.revision)
        ? { unitID, type: snapshot.type, rev: snapshot.rev }
        : null;
    },
    async getSnapshot(context, unitID, options) {
      guard(context.userID, unitID);
      return available(options?.revision) ? structuredClone(snapshot) : null;
    },
    async getSheetBlock(context, unitID, blockID) {
      guard(context.userID, unitID);
      const block = blocks.get(blockID);
      return block === undefined ? null : structuredClone(block);
    },
    async getChangesets(context, unitID, range) {
      guard(context.userID, unitID);
      const to = range.to ?? snapshot.rev;
      if (
        Number.isSafeInteger(range.from) &&
        Number.isSafeInteger(to) &&
        range.from === snapshot.rev &&
        to === snapshot.rev
      )
        return []; // SDK interval (rev, rev] is empty. Artifact bytes grant NO history.
      return denied();
    },
    commitChangeset: () => Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN"))),
    saveSnapshot: () => Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN"))),
    createUnit: () => Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN"))),
    deleteUnits: () => Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN"))),
    recoverUnits: () => Promise.reject(new OfficeForbidden(safeFailure("FORBIDDEN"))),
  };
}
