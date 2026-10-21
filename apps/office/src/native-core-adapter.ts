import { decodeWireSync, OfficeForbidden, safeFailure } from "@starter/office-contract";
import {
  HostNativeReads,
  HostNativeWrites,
  HostUnitRecord,
} from "@starter/office-server/native-remote";
import type { NativeAdapters } from "@starter/office-server/ports";
import type { NativeSession } from "./native-client.ts";
import type { NativeValues } from "./native-values.ts";
import { requireCommitted, stageSdkCommit, stageSdkSnapshot } from "./native-writes.ts";
import { invalidBytes } from "./native-stream-io.ts";

export function createNativeCoreAdapter(
  s: NativeSession,
  values: NativeValues,
): NativeAdapters["core"] {
  const handleId = s.handleId;
  return {
    getUnit: s.own(async (context, unitID) => {
      s.check(context.userID, unitID);
      const unit = await s.call(HostNativeReads.unit, { handleId, unitID }, false);
      if (unit && unit.unitID !== unitID) throw invalidBytes();
      return unit;
    }),
    getSnapshotInfo: s.own(async (context, unitID, options) => {
      s.check(context.userID, unitID);
      const revision = options?.revision ?? null;
      const info = await s.call(
        HostNativeReads.snapshotInfo,
        { handleId, unitID, revision },
        false,
      );
      if (
        info &&
        (info.unitID !== unitID || (revision !== null && revision > 0 && info.rev > revision))
      )
        throw invalidBytes();
      return info;
    }),
    getSnapshot: s.own(async (context, unitID, options) => {
      s.check(context.userID, unitID);
      const revision = options?.revision ?? null;
      const ref = await s.call(HostNativeReads.snapshot, { handleId, unitID, revision }, false);
      if (ref && revision !== null && revision > 0 && ref.revision > revision) throw invalidBytes();
      return ref ? values.snapshot(ref, { kind: "snapshot", revision: ref.revision }) : null;
    }),
    getSheetBlock: s.own(async (context, unitID, blockID) => {
      s.check(context.userID, unitID);
      const admitted = await values.block(blockID);
      if (admitted) return admitted;
      const ref = await s.call(
        HostNativeReads.snapshot,
        { handleId, unitID, revision: null },
        false,
      );
      if (ref) await values.snapshot(ref, { kind: "snapshot", revision: ref.revision });
      return values.block(blockID);
    }),
    getChangesets: s.own(async (context, unitID, range) => {
      s.check(context.userID, unitID);
      return values.history("", range);
    }),
    createUnit: s.own(async (context, input) => {
      s.check(context.userID, input.record.unitID);
      const record = decodeWireSync(HostUnitRecord)(structuredClone(input.record));
      const snapshotType: number = input.snapshot.type;
      if (record.type !== snapshotType || record.headRevision !== input.snapshot.rev)
        throw invalidBytes();
      const staged = await stageSdkSnapshot(s, values, input, "sdk-create");
      const result = await s.call(HostNativeWrites.create, { handleId, record, ...staged }, true);
      if (result.record.unitID !== s.target.unitId) throw invalidBytes();
      return result;
    }),
    saveSnapshot: s.own(async (context, input) => {
      s.check(context.userID, input.snapshot.unitID);
      const staged = await stageSdkSnapshot(s, values, input, "sdk-snapshot");
      await s.call(
        HostNativeWrites.saveSnapshot,
        { handleId, unitID: staged.manifest.unitID, ...staged },
        true,
      );
    }),
    commitChangeset: s.own(async (context, input) => {
      s.check(context.userID, input.changeset.unitID);
      if (context.memberID !== input.changeset.memberID) throw invalidBytes();
      const staged = await stageSdkCommit(s, values, input.changeset);
      const result = await s.call(
        HostNativeWrites.commit,
        { handleId, changeset: staged.changeset, producer: staged.producer },
        true,
      );
      return result.status === "committed"
        ? {
            status: result.status,
            headRevision: result.headRevision,
            changeset: await requireCommitted(values, staged, result),
          }
        : result;
    }),
    deleteUnits: s.own(async () => {
      throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    }),
    recoverUnits: s.own(async () => {
      throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    }),
  };
}
