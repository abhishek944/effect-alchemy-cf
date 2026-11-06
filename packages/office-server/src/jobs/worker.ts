import { diagnosticMetadata, reportFailure } from "@highchat/diagnostics";
import { jobEvent, type JobPhase } from "./worker-diagnostics.ts";
import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import { CodeText, decodeWireSync, OfficeInvalid, safeFailure } from "@highchat/office-contract";
import { encodeNativeFrame } from "@highchat/office-contract/native-wire";
import { decodeJobInput, digestBytes, requireSnapshot } from "./frames.ts";
import { decodeJobRequest } from "./transport.ts";
import { SnapshotWithBlocksSchema } from "./snapshot-schema.ts";
import { exportNative, importNative } from "./exchange.ts";
import { exportMediaType } from "./media.ts";
import { loadOfflineRuntime } from "./offline.ts";
import { inspectNative } from "./inspection.ts";
import { renderNative, type RenderOptions } from "./render.ts";

/** Run ONLY in a fresh credential-free outer job. This function is not a JS sandbox. */
export async function runOfficeJob(bytes: Uint8Array, render: RenderOptions): Promise<Uint8Array> {
  let request: ReturnType<typeof decodeJobRequest> | undefined;
  let phase: JobPhase = "decode";
  const started = Date.now();
  const enter = (next: JobPhase, emit = true): JobPhase => {
    const previous = phase;
    phase = next;
    if (emit) jobEvent(request, phase);
    return previous;
  };
  try {
    jobEvent(undefined, "decode");
    request = decodeJobRequest(bytes);
    const result = await executeJob(request, render, enter);
    jobEvent(request, "result", "application.complete", Date.now() - started);
    return result;
  } catch (cause) {
    reportFailure(cause, {
      ...diagnosticMetadata(process.env),
      component: request === undefined ? "office.job-entry" : "office.job",
      operation: request === undefined ? "run" : "execute",
      phase,
      reason: request === undefined ? "decode-failed" : "execution-failed",
      outcome: "failed",
      operationId: request?.job.binding.operationId,
      taskId: request?.job.binding.jobId,
    });
    throw cause;
  }
}
async function executeJob(
  { job, input, code }: ReturnType<typeof decodeJobRequest>,
  render: RenderOptions,
  enter: (phase: JobPhase, emit?: boolean) => JobPhase,
): Promise<Uint8Array> {
  const binding = job.binding;
  if (job.kind === "import") {
    if (
      job.options.kind !== binding.kind ||
      job.input.kind !== "upload" ||
      digestBytes(input) !== binding.inputDigest
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    enter("import");
    const native = decodeWireSync(SnapshotWithBlocksSchema)(await importNative(job, input));
    requireSnapshot(native, binding);
    enter("result");
    return encodeNativeFrame("job-output", { binding, native });
  }
  const seed = decodeJobInput(input, binding);
  if (job.kind === "export") {
    if (job.options.kind !== binding.kind) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    enter("export");
    const output = await exportNative(job, seed.native);
    enter("result");
    return encodeNativeFrame("job-output", {
      binding,
      bytes: output,
      mediaType: exportMediaType(job.options),
    });
  }
  enter("runtime");
  const runtime = await loadOfflineRuntime(seed);
  const executing = (async () => {
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
      enter("execute");
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
        result.state.awaitingChangeset !== null
      )
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      enter("result");
      return encodeNativeFrame("job-output", { binding, mutations: result.mutations });
    }
    if (job.kind === "inspect") {
      enter("inspect");
      const result = await inspectNative(runtime, binding, job.query);
      if (runtime.getState().pendingMutationCount !== 0)
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      enter("result");
      return encodeNativeFrame("job-output", { binding, result });
    }
    enter("render");
    const result = await renderNative(runtime, job, render);
    if (runtime.getState().pendingMutationCount !== 0 || result.images.length < 1)
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    enter("result");
    return encodeNativeFrame("job-output", {
      binding,
      images: result.images.map((image) => ({
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      })),
    });
  })();
  const result = await executing.then(
    (value) => ({ value }),
    (cause: unknown) => ({ cause }),
  );
  const executionPhase = enter("cleanup");
  const cleanup = await runtime.close().then(
    () => null,
    (cause: unknown) => ({ cause }),
  );
  if ("cause" in result) {
    enter(executionPhase, false); // Keep the first execution phase, not the later cleanup phase.
    throw cleanup === null
      ? result.cause
      : new AggregateError([result.cause, cleanup.cause], "Job execution and cleanup failed");
  }
  if (cleanup !== null) throw cleanup.cause;
  return result.value;
}
