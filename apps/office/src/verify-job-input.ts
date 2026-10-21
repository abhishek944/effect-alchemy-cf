import { createHash } from "node:crypto";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type { ExecutionBinding, IsolatedJob, JobBinding } from "@starter/office-server/ports";
import { encodeNativeFrame, NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type { Kind } from "@starter/office-contract";

export const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);
const id = (value: string) => hash(text(value));
export function executionInput(kind: Kind, native: ISnapshotWithBlocks, imageDigest: string) {
  const source =
    kind === "sheet"
      ? 'workbook.getActiveSheet().getRange("B2").setValue(73);'
      : kind === "doc"
        ? 'doc.insertText(0, "T19 native edit. ");'
        : 'presentation.getActiveSlide().getShapes()[0].getText().setText("T19 native slide edit");';
  const code = text(source);
  const jobId = id(`actual-t19-${kind}-${imageDigest}`);
  const binding: ExecutionBinding = {
    version: 1 as const,
    jobId,
    operationId: id(`operation-${jobId}`),
    ownerDigest: id(JSON.stringify(["disposable", "job-owner"])),
    documentId: id(`document-${kind}`),
    unitId: native.snapshot.unitID,
    kind,
    generation: 0,
    baseRevision: native.snapshot.rev,
    inputDigest: hash(encodeNativeFrame("snapshot", native)),
    codeDigest: hash(code),
    policyVersion: "office-native-content-v1",
    imageDigest,
    codec: NATIVE_WIRE_CODEC,
  };
  const input = encodeNativeFrame("job-input", { binding, native });
  const job: Extract<IsolatedJob, { kind: "execute" }> = {
    kind: "execute",
    binding,
    target: {
      documentId: binding.documentId,
      draftId: id(`draft-${kind}`),
      generation: 0,
      expectedRevision: binding.baseRevision,
    },
    input: {
      id: hash(input),
      kind: "native-input",
      digest: hash(input),
      bytes: input.byteLength,
      mediaType: "application/octet-stream",
    },
    code: {
      id: hash(code),
      kind: "code",
      digest: hash(code),
      bytes: code.byteLength,
      mediaType: "application/javascript",
    },
  };
  return { job, input, code };
}
export function readInput(
  base: JobBinding,
  native: ISnapshotWithBlocks,
  operation: "inspect" | "render" | "export",
) {
  const binding: JobBinding = {
    ...base,
    jobId: id(`${base.jobId}-${operation}`),
    operationId: id(`${base.operationId}-${operation}`),
    codeDigest: null,
    baseRevision: native.snapshot.rev,
    inputDigest: hash(encodeNativeFrame("snapshot", native)),
  };
  const input = encodeNativeFrame("job-input", { binding, native });
  return {
    binding,
    input: {
      id: hash(input),
      kind: "native-input" as const,
      digest: hash(input),
      bytes: input.byteLength,
      mediaType: "application/octet-stream",
    },
    bytes: input,
  };
}
