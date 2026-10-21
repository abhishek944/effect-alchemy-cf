import { Schema } from "effect";
import { Count } from "@starter/office-contract";
import { HostId, hostMethod } from "./host-wire.ts";
import {
  HostMergeResult,
  HostWorktreeAggregate,
  HostWorktreeRecord,
  HostWorktreeUnit,
  HostWorktreeStartMerge,
  HostWorktreeTransition,
} from "./adapter-records.ts";

const handle = { handleId: HostId };
const worktree = { ...handle, worktreeID: HostId };
const missing = Schema.Struct({ status: Schema.Literal("not-found") });
export const HostWorktreeWrites = Object.freeze({
  create: hostMethod(
    "draft.worktree-create",
    Schema.Struct({
      ...handle,
      record: HostWorktreeRecord,
      units: Schema.Array(HostWorktreeUnit).check(Schema.isMaxLength(1)),
    }),
    Schema.Struct({
      status: Schema.Literals(["created", "already-exists"]),
      aggregate: HostWorktreeAggregate,
    }),
  ),
  addUnit: hostMethod(
    "draft.add-unit",
    Schema.Struct({ ...handle, unit: HostWorktreeUnit }),
    Schema.Union([
      Schema.Struct({
        status: Schema.Literals(["added", "already-exists", "status-mismatch"]),
        aggregate: HostWorktreeAggregate,
      }),
      missing,
    ]),
  ),
  markReady: hostMethod("draft.mark-ready", Schema.Struct(worktree), HostWorktreeTransition),
  reopen: hostMethod("draft.reopen", Schema.Struct(worktree), HostWorktreeTransition),
  discard: hostMethod("draft.discard", Schema.Struct(worktree), HostWorktreeTransition),
  startMerge: hostMethod("draft.start-merge", Schema.Struct(worktree), HostWorktreeStartMerge),
  recordMergeResult: hostMethod(
    "draft.merge-result",
    Schema.Struct({
      ...worktree,
      unitID: HostId,
      readyDraftHeadRevision: Count,
      mergeResult: HostMergeResult,
    }),
    Schema.Union([
      Schema.Struct({
        status: Schema.Literals(["recorded", "already-recorded"]),
        aggregate: HostWorktreeAggregate,
      }),
      Schema.Struct({ status: Schema.Literals(["stale-merge", "not-found"]) }),
    ]),
  ),
  finishMerge: hostMethod("draft.finish-merge", Schema.Struct(worktree), HostWorktreeTransition),
});
