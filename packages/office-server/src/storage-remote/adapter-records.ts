import { Schema } from "effect";
import { Count, Revision } from "@starter/office-contract";
import { HostId } from "./host-wire.ts";

export const HostNativeType = Schema.Literals([1, 2, 3]);
export const HostUnitRecord = Schema.Struct({
  unitID: HostId,
  type: HostNativeType,
  headRevision: Revision,
  creatorID: HostId,
  createdAt: Count,
});
export const HostSnapshotInfo = Schema.Struct({
  unitID: HostId,
  type: HostNativeType,
  rev: Revision,
});
export const HostWorktreeStatus = Schema.Literals([
  "draft",
  "ready",
  "merging",
  "merged",
  "discarded",
]);
const mergeError = Schema.Struct({
  code: HostId,
  message: Schema.String.check(Schema.isMaxLength(512)),
  retryable: Schema.Boolean,
});
export const HostMergeResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("merged"), trunkRevision: Count }),
  Schema.Struct({ status: Schema.Literal("unchanged") }),
  Schema.Struct({ status: Schema.Literal("removed") }),
  Schema.Struct({ status: Schema.Literal("conflict"), error: mergeError }),
  Schema.Struct({ status: Schema.Literal("failed"), error: mergeError }),
]);
export const HostWorktreeRecord = Schema.Struct({
  worktreeID: HostId,
  sid: HostId,
  status: HostWorktreeStatus,
});
export const HostWorktreeUnit = Schema.Struct({
  worktreeID: HostId,
  unitID: HostId,
  type: HostNativeType,
  source: Schema.Literals(["trunk", "worktree"]),
  baselineTrunkRevision: Schema.optionalKey(Count),
  draftHeadRevision: Count,
  readyDraftHeadRevision: Schema.optionalKey(Count),
  creatorID: HostId,
  createdAt: Count,
  removed: Schema.optionalKey(Schema.Boolean),
  mergeResult: Schema.optionalKey(HostMergeResult),
});
export const HostWorktreeAggregate = Schema.Struct({
  worktree: HostWorktreeRecord,
  units: Schema.Array(HostWorktreeUnit).check(Schema.isMaxLength(1)),
});
export const HostWorktreeTransition = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("transitioned"),
    previousStatus: HostWorktreeStatus,
    aggregate: HostWorktreeAggregate,
  }),
  Schema.Struct({
    status: Schema.Literals(["already-in-target", "status-mismatch"]),
    aggregate: HostWorktreeAggregate,
  }),
  Schema.Struct({ status: Schema.Literal("not-found") }),
]);
export const HostWorktreeStartMerge = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["started", "resumed", "already-merged", "status-mismatch"]),
    aggregate: HostWorktreeAggregate,
  }),
  Schema.Struct({ status: Schema.Literal("not-found") }),
]);
