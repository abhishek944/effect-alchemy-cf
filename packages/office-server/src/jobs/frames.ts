import { createHash } from "node:crypto";
import { Schema } from "effect";
import { UniverType } from "@univerjs/protocol";
import { decodeWireSync, OfficeInvalid, safeFailure, type Kind } from "@starter/office-contract";
import {
  decodeNativeFrame,
  encodeNativeFrame,
  NATIVE_WIRE_LIMITS,
} from "@starter/office-contract/native-wire";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type {
  JobBinding,
  MutationCandidateFrame,
  NativeInputFrame,
  OwnerScope,
} from "../ports/index.ts";
import { JobBindingSchema, MutationCandidateSchema } from "./schemas.ts";
import { SnapshotWithBlocksSchema } from "./snapshot-schema.ts";

export const JOB_NATIVE_LIMITS = Object.freeze({
  ...NATIVE_WIRE_LIMITS,
  maxBytes: 32 * 1024 * 1024,
});
export const JOB_OUTPUT_LIMITS = Object.freeze({
  ...NATIVE_WIRE_LIMITS,
  maxBytes: 16 * 1024 * 1024,
});
export const digestBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export const ownerDigest = (owner: OwnerScope): string =>
  digestBytes(new TextEncoder().encode(JSON.stringify([owner.stage, owner.ownerId])));
export const snapshotDigest = (native: ISnapshotWithBlocks): string =>
  digestBytes(encodeNativeFrame("snapshot", native, JOB_NATIVE_LIMITS));
export function bindingKey(value: JobBinding): string {
  const b = decodeWireSync(JobBindingSchema)(value);
  return JSON.stringify([
    b.version,
    b.jobId,
    b.operationId,
    b.ownerDigest,
    b.documentId,
    b.unitId,
    b.kind,
    b.generation,
    b.baseRevision,
    b.inputDigest,
    b.codeDigest,
    b.policyVersion,
    b.imageDigest,
    b.codec,
  ]);
}
export function requireBinding(actual: JobBinding, expected: JobBinding): void {
  if (bindingKey(actual) !== bindingKey(expected))
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
}
const nativeTypes: Record<Kind, UniverType> = {
  doc: UniverType.UNIVER_DOC,
  sheet: UniverType.UNIVER_SHEET,
  slide: UniverType.UNIVER_SLIDE,
};
export function requireSnapshot(native: ISnapshotWithBlocks, binding: JobBinding): void {
  const { snapshot, sheetBlocks } = native;
  const meta =
    binding.kind === "sheet"
      ? snapshot.workbook
      : binding.kind === "doc"
        ? snapshot.doc
        : snapshot.slide;
  if (
    snapshot.unitID !== binding.unitId ||
    snapshot.type !== nativeTypes[binding.kind] ||
    !meta ||
    meta.unitID !== binding.unitId ||
    meta.rev !== snapshot.rev ||
    (binding.baseRevision !== null && snapshot.rev !== binding.baseRevision) ||
    Number(snapshot.workbook !== undefined) +
      Number(snapshot.doc !== undefined) +
      Number(snapshot.slide !== undefined) !==
      1
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT", binding.operationId));
  const blocks = new Map(sheetBlocks.map((block) => [block.id, block]));
  if (blocks.size !== sheetBlocks.length) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const used = new Set<string>();
  for (const [sheetId, group] of Object.entries(snapshot.workbook?.blockMeta ?? {})) {
    if (
      (group.sheetID !== undefined && group.sheetID !== sheetId) ||
      !snapshot.workbook?.sheets[sheetId]
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    for (const id of group.blocks) {
      const block = blocks.get(id);
      if (
        !block ||
        used.has(id) ||
        block.endRow < block.startRow ||
        block.data.byteLength > 2 * 1024 * 1024
      )
        throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
      used.add(id);
    }
  }
  if (used.size !== blocks.size) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
}
const InputSchema = Schema.Struct({ binding: JobBindingSchema, native: Schema.Unknown });
export function decodeJobInput(bytes: Uint8Array, expected: JobBinding): NativeInputFrame {
  const input = decodeWireSync(InputSchema)(
    decodeNativeFrame(bytes, "job-input", JOB_NATIVE_LIMITS).payload,
  );
  requireBinding(input.binding, expected);
  // Hash the original wire value before schema reconstruction can reorder object keys.
  if (
    digestBytes(encodeNativeFrame("snapshot", input.native, JOB_NATIVE_LIMITS)) !==
    expected.inputDigest
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  decodeWireSync(SnapshotWithBlocksSchema)(input.native);
  if (!Schema.is(SnapshotWithBlocksSchema)(input.native))
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  requireSnapshot(input.native, expected);
  return { binding: input.binding, native: input.native };
}
export function decodeMutationCandidate(
  bytes: Uint8Array,
  expected: JobBinding,
): MutationCandidateFrame {
  const result = decodeWireSync(MutationCandidateSchema)(
    decodeNativeFrame(bytes, "job-output", { ...JOB_OUTPUT_LIMITS, maxBytes: 2 * 1024 * 1024 })
      .payload,
  );
  requireBinding(result.binding, expected);
  return result;
}
