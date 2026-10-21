import { Predicate } from "effect";
import { decodeWireSync, OfficeForbidden, safeFailure } from "@starter/office-contract";
import {
  HostNativeReads,
  HostNativeWrites,
  HostWorktreeWrites,
  HostWorktreeUnit,
  HostWorktreeRecord,
  HostWorktreeAggregate,
  type NativeSnapshot,
  type PublishedOrigin,
} from "@starter/office-server/native-remote";
import type { NativeAdapters } from "@starter/office-server/ports";
import type { NativeSession } from "./native-client.ts";
import type { NativeValues } from "./native-values.ts";
import { requireCommitted, stageSdkCommit, stageSdkSnapshot } from "./native-writes.ts";
import { invalidBytes } from "./native-stream-io.ts";

export function createNativeDraftAdapter(
  s: NativeSession,
  values: NativeValues,
): NativeAdapters["worktrees"] {
  async function seed(ref: NativeSnapshot, origin: PublishedOrigin) {
    const snapshot = await values.snapshot(ref, origin),
      sheetBlocks = [];
    for (const block of ref.blocks) {
      const value = await values.block(block.blockID);
      if (!value) throw invalidBytes();
      sheetBlocks.push(value);
    }
    return { snapshot, sheetBlocks };
  }
  function aggregate(value: typeof HostWorktreeAggregate.Type): void {
    s.check(undefined, undefined, value.worktree.worktreeID);
    for (const unit of value.units) s.check(undefined, unit.unitID, unit.worktreeID);
  }
  function checked<A>(value: A): A {
    if (Predicate.isObject(value) && "aggregate" in value)
      aggregate(decodeWireSync(HostWorktreeAggregate)(value.aggregate));
    return value;
  }
  const handleId = s.handleId;
  return {
    getWorktree: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      const result = await s.call(HostNativeReads.worktree, { handleId, worktreeID }, false);
      if (result) aggregate(result);
      return result;
    }),
    getWorktreeUnit: s.own(async (context, worktreeID, unitID) => {
      s.check(context.userID, unitID, worktreeID);
      const result = await s.call(
        HostNativeReads.worktreeUnit,
        { handleId, worktreeID, unitID },
        false,
      );
      if (result) s.check(undefined, result.unitID, result.worktreeID);
      return result;
    }),
    getDraftChangesets: s.own(async (context, worktreeID, unitID, range) => {
      s.check(context.userID, unitID, worktreeID);
      return values.history(worktreeID, range);
    }),
    getUnitSeed: s.own(async (context, worktreeID, unitID) => {
      s.check(context.userID, unitID, worktreeID);
      const ref = await s.call(HostNativeReads.seed, { handleId, worktreeID, unitID }, false);
      return ref ? seed(ref, { kind: "seed", worktreeID }) : null;
    }),
    getUnitMergeArtifact: s.own(async (context, worktreeID, unitID) => {
      s.check(context.userID, unitID, worktreeID);
      const result = await s.call(
        HostNativeReads.mergeArtifact,
        { handleId, worktreeID, unitID },
        false,
      );
      return result
        ? {
            readyDraftHeadRevision: result.readyDraftHeadRevision,
            unit: await seed(result.manifest, {
              kind: "merge-artifact",
              worktreeID,
              readyRevision: result.readyDraftHeadRevision,
            }),
          }
        : null;
    }),
    createWorktree: s.own(async (context, input) => {
      s.check(context.userID, undefined, input.record.worktreeID);
      const record = decodeWireSync(HostWorktreeRecord)(structuredClone(input.record));
      const units = input.units.map((unit) =>
        decodeWireSync(HostWorktreeUnit)(structuredClone(unit)),
      );
      for (const unit of units) s.check(undefined, unit.unitID, unit.worktreeID);
      return checked(await s.call(HostWorktreeWrites.create, { handleId, record, units }, true));
    }),
    addUnit: s.own(async (context, input) => {
      const unit = decodeWireSync(HostWorktreeUnit)(structuredClone(input.unit));
      s.check(context.userID, unit.unitID, unit.worktreeID);
      return checked(await s.call(HostWorktreeWrites.addUnit, { handleId, unit }, true));
    }),
    createUnit: s.own(async (context, input) => {
      const unit = decodeWireSync(HostWorktreeUnit)(structuredClone(input.unit));
      s.check(context.userID, unit.unitID, unit.worktreeID);
      if (
        unit.unitID !== input.seed.snapshot.unitID ||
        unit.draftHeadRevision !== input.seed.snapshot.rev
      )
        throw invalidBytes();
      const staged = await stageSdkSnapshot(s, values, input.seed, "sdk-create");
      return checked(
        await s.call(HostNativeWrites.createDraft, { handleId, unit, ...staged }, true),
      );
    }),
    saveUnitMergeArtifact: s.own(async (context, input) => {
      const { worktreeID, unitID } = input,
        readyDraftHeadRevision = input.artifact.readyDraftHeadRevision;
      s.check(context.userID, unitID, worktreeID);
      const staged = await stageSdkSnapshot(s, values, input.artifact.unit, "sdk-merge");
      const result = await s.call(
        HostNativeWrites.saveMergeArtifact,
        { handleId, worktreeID, unitID, readyDraftHeadRevision, ...staged },
        true,
      );
      return "manifest" in result
        ? {
            status: result.status,
            artifact: {
              readyDraftHeadRevision: result.readyDraftHeadRevision,
              unit: await seed(result.manifest, {
                kind: "merge-artifact",
                worktreeID,
                readyRevision: result.readyDraftHeadRevision,
              }),
            },
          }
        : result;
    }),
    commitDraftChangeset: s.own(async (context, input) => {
      s.check(context.userID, input.changeset.unitID, input.worktreeID);
      const worktreeID = input.worktreeID,
        staged = await stageSdkCommit(s, values, input.changeset);
      const result = await s.call(
        HostNativeWrites.commitDraft,
        { handleId, worktreeID, changeset: staged.changeset, producer: staged.producer },
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
    markReady: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      return checked(await s.call(HostWorktreeWrites.markReady, { handleId, worktreeID }, true));
    }),
    reopenWorktree: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      return checked(await s.call(HostWorktreeWrites.reopen, { handleId, worktreeID }, true));
    }),
    discardWorktree: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      return checked(await s.call(HostWorktreeWrites.discard, { handleId, worktreeID }, true));
    }),
    startOrResumeMerge: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      return checked(await s.call(HostWorktreeWrites.startMerge, { handleId, worktreeID }, true));
    }),
    recordUnitMergeResult: s.own(async (context, input) => {
      s.check(context.userID, input.unitID, input.worktreeID);
      return checked(
        await s.call(HostWorktreeWrites.recordMergeResult, { handleId, ...input }, true),
      );
    }),
    finishMerge: s.own(async (context, worktreeID) => {
      s.check(context.userID, undefined, worktreeID);
      return checked(await s.call(HostWorktreeWrites.finishMerge, { handleId, worktreeID }, true));
    }),
    setUnitRemoved: s.own(async () => {
      throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    }),
  };
}
