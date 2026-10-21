import type {
  HostNativeWrites,
  HostWorktreeWrites,
  NativeChange,
  NativeSnapshot,
} from "@starter/office-server/native-remote";
import type { OfficeNativeHandle } from "./office-native-handles.ts";
import { officeDenied, officeNativeContext } from "./office-private-authority.ts";

type WriteCall =
  | (typeof HostNativeWrites)[keyof typeof HostNativeWrites]["request"]["Type"]
  | (typeof HostWorktreeWrites)[keyof typeof HostWorktreeWrites]["request"]["Type"];
const change = (value: NativeChange) => {
  const { sid, reqId, ...rest } = value;
  return { ...rest, ...(sid === null ? {} : { sid }), ...(reqId === null ? {} : { reqId }) };
};
export async function officeNativeWrite(
  handle: OfficeNativeHandle,
  call: WriteCall,
): Promise<unknown> {
  const held = handle.writer;
  if (held === null) throw officeDenied();
  if (held.kind === "editor" && call.method !== "core.commit" && call.method !== "draft.commit")
    throw officeDenied();
  const { writer } = held;
  const user = officeNativeContext(handle.request, call);
  const input = call.input;
  if (
    ("unitID" in input && input.unitID !== handle.target.unitId) ||
    ("worktreeID" in input && input.worktreeID !== handle.worktreeId)
  )
    throw officeDenied();
  const snapshot = async (
    value: NativeSnapshot,
    producer: Extract<WriteCall, { input: { producer: unknown } }>["input"]["producer"],
  ) => {
    if (value.unitID !== handle.target.unitId) throw officeDenied();
    await held.verify(value.snapshot, producer);
    for (const block of value.blocks) await held.verify(block.value, producer);
  };
  switch (call.method) {
    case "core.create":
      await snapshot(call.input.manifest, call.input.producer);
      if (call.input.record.unitID !== handle.target.unitId) throw officeDenied();
      return writer.references.core.createUnit(call.input.record, call.input.manifest);
    case "core.snapshot-save":
      await snapshot(call.input.manifest, call.input.producer);
      await writer.references.core.saveSnapshot(call.input.manifest);
      return null;
    case "core.commit":
      await held.verify(call.input.changeset.value, call.input.producer);
      if (call.input.changeset.unitID !== handle.target.unitId) throw officeDenied();
      return writer.references.core.commitChangeset(change(call.input.changeset));
    case "draft.create":
      await snapshot(call.input.manifest, call.input.producer);
      if (
        call.input.unit.unitID !== handle.target.unitId ||
        call.input.unit.worktreeID !== handle.worktreeId
      )
        throw officeDenied();
      return writer.references.worktree.createUnit(call.input.unit, call.input.manifest);
    case "draft.artifact-save": {
      await snapshot(call.input.manifest, call.input.producer);
      const result = await writer.references.worktree.saveUnitMergeArtifact(
        call.input.worktreeID,
        call.input.readyDraftHeadRevision,
        call.input.manifest,
      );
      return "manifest" in result
        ? { ...result, manifest: await writer.references.payloads.readManifest(result.manifest) }
        : result;
    }
    case "draft.commit":
      await held.verify(call.input.changeset.value, call.input.producer);
      if (call.input.changeset.unitID !== handle.target.unitId) throw officeDenied();
      return writer.references.worktree.commitDraftChangeset(
        call.input.worktreeID,
        change(call.input.changeset),
      );
    case "draft.worktree-create":
      if (
        call.input.record.worktreeID !== handle.worktreeId ||
        call.input.units.some((unit) => unit.unitID !== handle.target.unitId)
      )
        throw officeDenied();
      return writer.worktrees.createWorktree(user, {
        record: call.input.record,
        units: call.input.units,
      });
    case "draft.add-unit":
      if (
        call.input.unit.unitID !== handle.target.unitId ||
        call.input.unit.worktreeID !== handle.worktreeId
      )
        throw officeDenied();
      return writer.worktrees.addUnit(user, { unit: call.input.unit });
    case "draft.mark-ready":
      return writer.worktrees.markReady(user, call.input.worktreeID);
    case "draft.reopen":
      return writer.worktrees.reopenWorktree(user, call.input.worktreeID);
    case "draft.discard":
      return writer.worktrees.discardWorktree(user, call.input.worktreeID);
    case "draft.start-merge":
      return writer.worktrees.startOrResumeMerge(user, call.input.worktreeID);
    case "draft.merge-result":
      return writer.worktrees.recordUnitMergeResult(user, {
        worktreeID: call.input.worktreeID,
        unitID: call.input.unitID,
        readyDraftHeadRevision: call.input.readyDraftHeadRevision,
        mergeResult: call.input.mergeResult,
      });
    case "draft.finish-merge":
      return writer.worktrees.finishMerge(user, call.input.worktreeID);
  }
  throw officeDenied();
}
