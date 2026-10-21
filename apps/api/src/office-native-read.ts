import type { HostNativeReads } from "@starter/office-server/native-remote";
import type { OfficeNativeHandle } from "./office-native-handles.ts";
import { officeDenied, officeNativeContext } from "./office-private-authority.ts";

type ReadCall = (typeof HostNativeReads)[keyof typeof HostNativeReads]["request"]["Type"];
export async function officeNativeRead(
  handle: OfficeNativeHandle,
  call: ReadCall,
): Promise<unknown> {
  const input = call.input;
  const user = officeNativeContext(handle.request, call);
  const reads = handle.reads;
  const mainUnit = async () => {
    const unit = await handle.pair.database.getUnit(user, handle.target.unitId);
    if (unit === null || handle.writer?.kind !== "editor" || handle.target.scope.kind !== "draft")
      return unit;
    return handle.baselineRevision === null
      ? null
      : { ...unit, headRevision: Math.min(unit.headRevision, handle.baselineRevision) };
  };
  if (
    ("unitID" in input && input.unitID !== handle.target.unitId) ||
    ("worktreeID" in input && input.worktreeID !== handle.worktreeId)
  )
    throw officeDenied();
  switch (call.method) {
    case "core.unit":
      return mainUnit();
    case "core.snapshot-info": {
      const snapshot = await reads.snapshot(call.input.revision ?? undefined);
      return snapshot === null
        ? null
        : { unitID: snapshot.unitID, type: snapshot.type, rev: snapshot.revision };
    }
    case "core.snapshot":
      return reads.snapshot(call.input.revision ?? undefined);
    case "draft.record":
      return handle.pair.worktrees.getWorktree(user, call.input.worktreeID);
    case "draft.unit":
      return handle.pair.worktrees.getWorktreeUnit(user, call.input.worktreeID, call.input.unitID);
    case "draft.seed":
      return reads.seed(call.input.worktreeID);
    case "draft.merge-artifact":
      return reads.mergeArtifact(call.input.worktreeID);
    case "core.changesets":
    case "draft.changesets": {
      const branch = call.method === "draft.changesets" ? call.input.worktreeID : "";
      const unit =
        branch === ""
          ? await mainUnit()
          : await handle.pair.worktrees.getWorktreeUnit(user, branch, handle.target.unitId);
      if (unit === null) return null;
      const head = "headRevision" in unit ? unit.headRevision : unit.draftHeadRevision;
      const from = call.input.cursor === null ? call.input.from : Number(call.input.cursor);
      const to = call.input.to ?? head;
      if (
        (call.input.cursor !== null && !/^(0|[1-9][0-9]{0,15})$/.test(call.input.cursor)) ||
        !Number.isSafeInteger(from) ||
        from < call.input.from ||
        to > head ||
        to < from
      )
        throw officeDenied();
      const rows = (await reads.changesets(branch, from, 128)).filter((row) => row.revision <= to);
      let current = from;
      for (const row of rows) {
        if (row.revision !== current + 1) throw officeDenied();
        current = row.revision;
      }
      if (current < to && rows.length !== 128) throw officeDenied();
      return {
        rows: rows.map((row) => ({
          unitID: handle.target.unitId,
          type: unit.type,
          revision: row.revision,
          baseRev: row.revision - 1,
          sid: row.sid,
          reqId: row.reqId,
          value: row.value,
        })),
        next: current < to ? String(current) : null,
      };
    }
  }
  throw officeDenied();
}
