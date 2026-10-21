import { Schema } from "effect";
import type { UnitRecord } from "@univerjs-pro/collaboration-service";
import type {
  WorktreeRecord,
  WorktreeUnitRecord,
  WorktreeUnitMergeResult,
  CreateWorktreeDatabaseInput,
  SetWorktreeUnitRemovedDatabaseInput,
  RecordUnitMergeResultInput,
} from "@univerjs-pro/collaboration-worktree-service";
import {
  boundedArray,
  NativeName,
  NativeType,
  Natural,
  objectFields,
  parseMetadata,
} from "./metadata-parse.ts";

export const MergeResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("merged"), trunkRevision: Natural }),
  Schema.Struct({ status: Schema.Literals(["unchanged", "removed"]) }),
  Schema.Struct({
    status: Schema.Literals(["conflict", "failed"]),
    error: Schema.Struct({
      code: NativeName,
      message: Schema.String.check(Schema.isMaxLength(512)),
      retryable: Schema.Boolean,
    }),
  }),
]);
const Unit = Schema.Struct({
  unitID: NativeName,
  type: NativeType,
  headRevision: Natural,
  creatorID: NativeName,
  createdAt: Natural,
});
const Worktree = Schema.Struct({
  worktreeID: NativeName,
  sid: NativeName,
  status: Schema.Literals(["draft", "ready", "merging", "merged", "discarded"]),
});
const Draft = Schema.Struct({
  worktreeID: NativeName,
  unitID: NativeName,
  type: NativeType,
  source: Schema.Literals(["trunk", "worktree"]),
  baselineTrunkRevision: Schema.optional(Natural),
  draftHeadRevision: Natural,
  readyDraftHeadRevision: Schema.optional(Natural),
  creatorID: NativeName,
  createdAt: Natural,
  removed: Schema.optional(Schema.Boolean),
  mergeResult: Schema.optional(MergeResult),
});
export function readUnitRecord(input: unknown): UnitRecord {
  return parseMetadata(
    Unit,
    objectFields(input, ["unitID", "type", "headRevision", "creatorID", "createdAt"]),
  );
}
export function readWorktreeRecord(input: unknown): WorktreeRecord {
  return parseMetadata(Worktree, objectFields(input, ["worktreeID", "sid", "status"]));
}
export function readMergeResult(input: unknown): WorktreeUnitMergeResult {
  const object = objectFields(input, ["status", "trunkRevision", "error"]);
  if (object.error !== undefined) objectFields(object.error, ["code", "message", "retryable"]);
  return parseMetadata(MergeResult, object);
}
export function readWorktreeUnit(input: unknown): WorktreeUnitRecord {
  const object = objectFields(input, [
    "worktreeID",
    "unitID",
    "type",
    "source",
    "baselineTrunkRevision",
    "draftHeadRevision",
    "readyDraftHeadRevision",
    "creatorID",
    "createdAt",
    "removed",
    "mergeResult",
  ]);
  const value = parseMetadata(Draft, {
    ...object,
    ...(object.mergeResult === undefined
      ? {}
      : { mergeResult: readMergeResult(object.mergeResult) }),
  });
  return {
    worktreeID: value.worktreeID,
    unitID: value.unitID,
    type: value.type,
    source: value.source,
    draftHeadRevision: value.draftHeadRevision,
    creatorID: value.creatorID,
    createdAt: value.createdAt,
    ...(value.baselineTrunkRevision === undefined
      ? {}
      : { baselineTrunkRevision: value.baselineTrunkRevision }),
    ...(value.readyDraftHeadRevision === undefined
      ? {}
      : { readyDraftHeadRevision: value.readyDraftHeadRevision }),
    ...(value.removed === undefined ? {} : { removed: value.removed }),
    ...(value.mergeResult === undefined ? {} : { mergeResult: value.mergeResult }),
  };
}
export function readCreateWorktree(input: unknown): CreateWorktreeDatabaseInput {
  const object = objectFields(input, ["record", "units"]);
  return {
    record: readWorktreeRecord(object.record),
    units: boundedArray(object.units, 1).map(readWorktreeUnit),
  };
}
export function readRemoved(input: unknown): SetWorktreeUnitRemovedDatabaseInput {
  const object = objectFields(input, ["worktreeID", "unitID", "removed"]);
  return parseMetadata(
    Schema.Struct({ worktreeID: NativeName, unitID: NativeName, removed: Schema.Boolean }),
    object,
  );
}
export function readMergeInput(input: unknown): RecordUnitMergeResultInput {
  const object = objectFields(input, [
    "worktreeID",
    "unitID",
    "readyDraftHeadRevision",
    "mergeResult",
  ]);
  return parseMetadata(
    Schema.Struct({
      worktreeID: NativeName,
      unitID: NativeName,
      readyDraftHeadRevision: Natural,
      mergeResult: MergeResult,
    }),
    { ...object, mergeResult: readMergeResult(object.mergeResult) },
  );
}
