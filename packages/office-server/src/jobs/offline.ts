import { OfficeForbidden, OfficeInvalid, safeFailure } from "@starter/office-contract";
import type { CollaborationRuntimeBackend } from "@univer-cli/univer-collaboration-runtime";
import type { NativeInputFrame } from "../ports/jobs.ts";
import { OFFICE_NATIVE_TYPES, createOfficeRuntimeFactory } from "./runtime-factory.ts";
import { requireSnapshot } from "./frames.ts";

/** Finite immutable checkpoint reader, not an application database or an online backend. */
export async function loadOfflineRuntime(input: NativeInputFrame) {
  const { binding, native } = input;
  requireSnapshot(native, binding);
  const blocks = new Map(native.sheetBlocks.map((block) => [block.id, block]));
  let closed = false;
  const check = () => {
    if (closed) throw new OfficeInvalid(safeFailure("UNAVAILABLE"));
  };
  const backend: CollaborationRuntimeBackend = {
    async open(target) {
      if (target.unitId !== binding.unitId || target.unitType !== OFFICE_NATIVE_TYPES[binding.kind])
        throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      return {
        format: "snapshot",
        getConnectionState: () => (closed ? "closed" : "offline"),
        async getUnitOnRev(revision) {
          check();
          if (revision !== undefined && revision !== 0 && revision !== native.snapshot.rev)
            throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
          return { error: undefined, snapshot: native.snapshot, changesets: [] };
        },
        async getSheetBlock(id) {
          check();
          const block = blocks.get(id);
          if (!block) throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
          return { error: undefined, block };
        },
        async fetchChangesets(from, to) {
          check();
          if (from !== native.snapshot.rev || (to !== undefined && to !== 0 && to !== from))
            throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
          return { error: undefined, changesets: [], latestRevision: native.snapshot.rev };
        },
        async submitChangeset() {
          throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        },
        async close() {
          closed = true;
        },
      };
    },
  };
  return createOfficeRuntimeFactory(backend, { maxCodeLength: 32 * 1024 }).load(
    binding.unitId,
    OFFICE_NATIVE_TYPES[binding.kind],
  );
}
