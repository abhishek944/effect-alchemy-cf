import { Schema } from "effect";
import {
  Count,
  decodeWireSync,
  OfficeForbidden,
  OfficeInvalid,
  safeFailure,
} from "@starter/office-contract";
import { UniverUnitRuntime, type IUnitRuntimeReader } from "@univerjs-pro/collaboration-service";
import type { IChangeset, IMutation } from "@univerjs/protocol";
import type { NativeInputFrame, NativeProposalFrame } from "../ports/jobs.ts";
import { requireSnapshot } from "./frames.ts";
import { ProposalBindingSchema, MutationSchema } from "./schemas.ts";
import { requirePreservedSheetResources } from "./sheet-resources.ts";

const Identity = Schema.Struct({
  userId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  memberId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  sid: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reqId: Count.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type NativeSubmissionIdentity = typeof Identity.Type;
/** Semantic validation only, never write admission. No source is evaluated in this clean SDK. */
export async function replayMutationCandidate(
  input: NativeInputFrame,
  mutations: readonly IMutation[],
  submission: NativeSubmissionIdentity,
  preserveWorkbookResources = false,
): Promise<NativeProposalFrame> {
  const binding = decodeWireSync(ProposalBindingSchema)(input.binding);
  const checked = decodeWireSync(Schema.Array(MutationSchema).check(Schema.isMaxLength(5000)))(
    mutations,
  );
  const identity = decodeWireSync(Identity)(submission);
  requireSnapshot(input.native, binding);
  const changeset: IChangeset = {
    unitID: binding.unitId,
    type: input.native.snapshot.type,
    baseRev: binding.baseRevision,
    revision: binding.baseRevision + 1,
    userID: identity.userId,
    memberID: identity.memberId,
    sid: identity.sid,
    reqId: identity.reqId,
    mutations: checked.map((mutation) => ({ ...mutation })),
  };
  const check = (unitId: string) => {
    if (unitId !== binding.unitId) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
  };
  const reader: IUnitRuntimeReader = {
    async getUnit(_context, unitId) {
      check(unitId);
      return {
        unitID: unitId,
        type: input.native.snapshot.type,
        headRevision: binding.baseRevision,
      };
    },
    async getSnapshot(_context, unitId, options) {
      check(unitId);
      if (options?.revision !== undefined && options.revision !== binding.baseRevision)
        throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
      return input.native.snapshot;
    },
    async getSheetBlock(_context, unitId, blockId) {
      check(unitId);
      const block = input.native.sheetBlocks.find((value) => value.id === blockId);
      if (!block) throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
      return block;
    },
    async getChangesets(_context, unitId, range) {
      check(unitId);
      if (
        range.from !== binding.baseRevision ||
        (range.to !== undefined && range.to !== range.from)
      )
        throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
      return [];
    },
  };
  const runtime = new UniverUnitRuntime({ reader, maxLoadedUnits: 1, idleTimeoutMs: 1000 });
  const context = { userID: identity.userId, customData: {}, request: {} };
  try {
    const handle = await runtime.ensureUnit(context, binding.unitId, input.native.snapshot.type);
    try {
      if (handle.revision !== binding.baseRevision)
        throw new OfficeInvalid(safeFailure("STALE_BASIS"));
      if (changeset.mutations.length > 0) {
        const result = await runtime.applyChangeset(context, handle, changeset, {
          collectUnitPermissions: true,
        });
        if (
          result.requiredUnitPermissions.some((permission) => permission.unitID !== binding.unitId)
        )
          throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        const saved = await runtime.createSnapshot(handle);
        if (preserveWorkbookResources)
          requirePreservedSheetResources(
            input.native.snapshot.workbook?.resources,
            saved.snapshot.workbook?.resources,
          );
        requireSnapshot(
          { snapshot: saved.snapshot, sheetBlocks: [...(saved.sheetBlocks ?? [])] },
          { ...binding, baseRevision: changeset.revision },
        );
      }
      return { binding, changeset };
    } finally {
      runtime.releaseUnit(handle);
    }
  } finally {
    await runtime.dispose();
  }
}
