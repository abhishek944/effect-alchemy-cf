import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import { CodeText, decodeWireSync, OfficeInvalid, safeFailure } from "@starter/office-contract";
import { encodeNativeFrame } from "@starter/office-contract/native-wire";
import { decodeJobInput, digestBytes, JOB_OUTPUT_LIMITS, requireSnapshot } from "./frames.ts";
import { decodeJobRequest } from "./transport.ts";
import { SnapshotWithBlocksSchema } from "./snapshot-schema.ts";
import { exportNative, importNative } from "./exchange.ts";
import { exportMediaType } from "./media.ts";
import { loadOfflineRuntime } from "./offline.ts";
import { inspectNative } from "./inspection.ts";
import { renderNative, type RenderOptions } from "./render.ts";

/** Run ONLY in a fresh credential-free outer job. This function is not a JS sandbox. */
export async function runOfficeJob(bytes: Uint8Array, render: RenderOptions): Promise<Uint8Array> {
  const { job, input, code } = decodeJobRequest(bytes);
  const binding = job.binding;
  if (job.kind === "import") {
    if (
      job.options.kind !== binding.kind ||
      job.input.kind !== "upload" ||
      input.byteLength > 10 * 1024 * 1024 ||
      digestBytes(input) !== binding.inputDigest
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    const native = decodeWireSync(SnapshotWithBlocksSchema)(await importNative(job, input));
    requireSnapshot(native, binding);
    return encodeNativeFrame("job-output", { binding, native }, JOB_OUTPUT_LIMITS);
  }
  const seed = decodeJobInput(input, binding);
  if (job.kind === "export") {
    if (job.options.kind !== binding.kind) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    const output = await exportNative(job, seed.native);
    if (output.byteLength > 10 * 1024 * 1024)
      throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
    return encodeNativeFrame(
      "job-output",
      { binding, bytes: output, mediaType: exportMediaType(job.options) },
      JOB_OUTPUT_LIMITS,
    );
  }
  const runtime = await loadOfflineRuntime(seed);
  try {
    if (job.kind === "execute") {
      const source = decodeWireSync(CodeText)(
        new TextDecoder("utf-8", { fatal: true }).decode(code),
      );
      if (
        job.target.documentId !== binding.documentId ||
        job.target.generation !== binding.generation ||
        job.target.expectedRevision !== binding.baseRevision ||
        job.code.kind !== "code"
      )
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      const result = await runtime.execute({
        mode: "write",
        code: prepareContentExecutionProgram({
          code: source,
          unitId: binding.unitId,
          unitType: binding.kind,
        }),
      });
      if (
        result.state.baseRevision !== binding.baseRevision ||
        result.state.awaitingChangeset !== null ||
        result.mutations.length > 5000
      )
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      return encodeNativeFrame(
        "job-output",
        { binding, mutations: result.mutations },
        { ...JOB_OUTPUT_LIMITS, maxBytes: 2 * 1024 * 1024 },
      );
    }
    if (job.kind === "inspect") {
      const result = await inspectNative(runtime, binding, job.query);
      if (runtime.getState().pendingMutationCount !== 0)
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      return encodeNativeFrame(
        "job-output",
        { binding, result },
        { ...JOB_OUTPUT_LIMITS, maxBytes: 64 * 1024 },
      );
    }
    const result = await renderNative(runtime, job, render);
    if (
      runtime.getState().pendingMutationCount !== 0 ||
      result.images.length < 1 ||
      result.images.length > 8
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    let pixels = 0,
      total = 0;
    for (const image of result.images) {
      pixels += image.width * image.height;
      total += image.bytes.byteLength;
      if (pixels > 16_000_000 || total > 16 * 1024 * 1024)
        throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
    }
    return encodeNativeFrame(
      "job-output",
      {
        binding,
        images: result.images.map((image) => ({
          bytes: image.bytes,
          width: image.width,
          height: image.height,
        })),
      },
      JOB_OUTPUT_LIMITS,
    );
  } finally {
    await runtime.close();
  }
}
