import { Schema } from "effect";
import { Count, Cursor } from "@starter/office-contract";
import { HostId, hostMethod } from "./host-wire.ts";
import {
  HostSnapshotInfo,
  HostUnitRecord,
  HostWorktreeAggregate,
  HostWorktreeUnit,
} from "./adapter-records.ts";
import { NativeChange, NativeSnapshot, NativeValue, NativeProducer } from "./wire.ts";
import { HostNativeProducer } from "./producer-wire.ts";

const handle = { handleId: HostId };
const unit = { ...handle, unitID: HostId };
const draft = { ...unit, worktreeID: HostId };
const history = Schema.Struct({
  rows: Schema.Array(NativeChange).check(Schema.isMaxLength(128)),
  next: Cursor,
});
const historyRange = { from: Count, to: Schema.NullOr(Count), cursor: Cursor };
export const HostNativeReads = Object.freeze({
  unit: hostMethod("core.unit", Schema.Struct(unit), Schema.NullOr(HostUnitRecord)),
  snapshotInfo: hostMethod(
    "core.snapshot-info",
    Schema.Struct({ ...unit, revision: Schema.NullOr(Count) }),
    Schema.NullOr(HostSnapshotInfo),
  ),
  snapshot: hostMethod(
    "core.snapshot",
    Schema.Struct({ ...unit, revision: Schema.NullOr(Count) }),
    Schema.NullOr(NativeSnapshot),
  ),
  changesets: hostMethod(
    "core.changesets",
    Schema.Struct({ ...unit, ...historyRange }),
    Schema.NullOr(history),
  ),
  worktree: hostMethod(
    "draft.record",
    Schema.Struct({ ...handle, worktreeID: HostId }),
    Schema.NullOr(HostWorktreeAggregate),
  ),
  worktreeUnit: hostMethod("draft.unit", Schema.Struct(draft), Schema.NullOr(HostWorktreeUnit)),
  draftChangesets: hostMethod(
    "draft.changesets",
    Schema.Struct({ ...draft, ...historyRange }),
    Schema.NullOr(history),
  ),
  seed: hostMethod("draft.seed", Schema.Struct(draft), Schema.NullOr(NativeSnapshot)),
  mergeArtifact: hostMethod(
    "draft.merge-artifact",
    Schema.Struct(draft),
    Schema.NullOr(
      Schema.Struct({
        readyDraftHeadRevision: Count,
        manifest: NativeSnapshot,
      }),
    ),
  ),
});
const committed = Schema.Struct({
  status: Schema.Literal("committed"),
  headRevision: Count,
  value: NativeValue,
});
const mismatch = Schema.Struct({
  status: Schema.Literal("revision-mismatch"),
  actualHeadRevision: Count,
});
const missing = Schema.Struct({ status: Schema.Literal("not-found") });
const coreCreated = Schema.Struct({
  status: Schema.Literals(["created", "already-exists"]),
  record: HostUnitRecord,
});
const draftCreated = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["created", "already-created", "unit-exists", "status-mismatch"]),
    aggregate: HostWorktreeAggregate,
  }),
  missing,
]);
const artifactSaved = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["saved", "already-saved"]),
    readyDraftHeadRevision: Count,
    manifest: NativeSnapshot,
  }),
  Schema.Struct({ status: Schema.Literals(["stale-merge", "not-found"]) }),
]);
export const HostNativeWrites = Object.freeze({
  create: hostMethod(
    "core.create",
    Schema.Struct({
      ...handle,
      record: HostUnitRecord,
      manifest: NativeSnapshot,
      producer: NativeProducer,
    }),
    coreCreated,
  ),
  saveSnapshot: hostMethod(
    "core.snapshot-save",
    Schema.Struct({
      ...unit,
      manifest: NativeSnapshot,
      producer: NativeProducer,
    }),
    Schema.Null,
  ),
  commit: hostMethod(
    "core.commit",
    Schema.Struct({
      ...handle,
      changeset: NativeChange,
      producer: HostNativeProducer,
    }),
    Schema.Union([committed, mismatch]),
  ),
  createDraft: hostMethod(
    "draft.create",
    Schema.Struct({
      ...handle,
      unit: HostWorktreeUnit,
      manifest: NativeSnapshot,
      producer: NativeProducer,
    }),
    draftCreated,
  ),
  saveMergeArtifact: hostMethod(
    "draft.artifact-save",
    Schema.Struct({
      ...draft,
      readyDraftHeadRevision: Count,
      manifest: NativeSnapshot,
      producer: NativeProducer,
    }),
    artifactSaved,
  ),
  commitDraft: hostMethod(
    "draft.commit",
    Schema.Struct({
      ...handle,
      worktreeID: HostId,
      changeset: NativeChange,
      producer: HostNativeProducer,
    }),
    Schema.Union([
      committed,
      mismatch,
      Schema.Struct({
        status: Schema.Literal("not-editable"),
        worktreeStatus: Schema.Literals(["draft", "ready", "merging", "merged", "discarded"]),
      }),
      Schema.Struct({ status: Schema.Literals(["unit-frozen", "not-found"]) }),
    ]),
  ),
});
