import { Clock, Effect } from "effect";
import {
  withCause,
  withDiagnostic,
  diagnosticMetadata,
  reportEvent,
  reportEventEffect,
  reportFailureEffect,
} from "@highchat/diagnostics";
import {
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type ArtifactRef,
} from "@highchat/office-contract";
import type { IsolatedJob, JobState, OfficeBytes, OwnerScope } from "../ports/index.ts";
import { unknownJobState } from "./identity.ts";
import { byteStream, readJobArtifact } from "./artifacts.ts";
import { digestBytes } from "./frames.ts";
import { validateJobOutput } from "./output.ts";
import { encodeJobRequest } from "./transport.ts";
import type { FreshJobPlacement } from "./placement.ts";
export const computeJobState = Effect.fn("Office.jobs.compute")(function* (
  bytes: OfficeBytes,
  placement: FreshJobPlacement,
  owner: OwnerScope,
  job: IsolatedJob,
  controller: AbortController,
  deadlineAt: number,
): Effect.fn.Return<JobState> {
  const remaining = deadlineAt - (yield* Clock.currentTimeMillis);
  if (remaining <= 0 || controller.signal.aborted) {
    controller.abort();
    return unknownJobState(job);
  }
  return yield* runIsolatedJob(bytes, placement, owner, job, controller, deadlineAt).pipe(
    Effect.timeoutOrElse({
      duration: remaining,
      orElse: () =>
        Effect.fail(
          withDiagnostic(
            new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", job.binding.operationId)),
            "compute-deadline",
          ),
        ),
    }),
    Effect.map((output) => ({
      state: "succeeded" as const,
      jobId: job.binding.jobId,
      inputDigest: job.binding.inputDigest,
      output,
    })),
    Effect.catch((error) =>
      reportFailureEffect(error, {
        component: "office.job-supervisor",
        operation: "compute",
        operationId: job.binding.operationId,
        taskId: job.binding.jobId,
        deadlineAt,
        durationMs: Date.now() - (deadlineAt - remaining),
      }).pipe(
        Effect.as(
          error.code === "OUTCOME_UNKNOWN"
            ? unknownJobState(job)
            : {
                state: "failed" as const,
                jobId: job.binding.jobId,
                error: safeFailure(error.code, job.binding.operationId),
              },
        ),
      ),
    ),
  );
});

export const runIsolatedJob = Effect.fn("Office.jobs.run")(function* (
  bytes: OfficeBytes,
  placement: FreshJobPlacement,
  owner: OwnerScope,
  job: IsolatedJob,
  controller: AbortController,
  deadlineAt: number,
) {
  const diagnostic = {
    ...diagnosticMetadata(process.env),
    component: "office.job-supervisor",
    operation: "compute",
    operationId: job.binding.operationId,
    taskId: job.binding.jobId,
    deadlineAt,
  };
  let began = Date.now();
  const event = (phase: string, reason: "entered" | "completed", size?: number) => {
    if (reason === "entered") began = Date.now();
    return reportEventEffect({
      ...diagnostic,
      phase,
      reason,
      bytes: size,
      durationMs: Date.now() - began,
      outcome: reason === "completed" ? "confirmed" : undefined,
    });
  };
  yield* event("input-read", "entered");
  const input = yield* readJobArtifact(bytes, owner, job.input, controller.signal);
  const code =
    job.kind === "execute"
      ? yield* readJobArtifact(bytes, owner, job.code, controller.signal)
      : new Uint8Array();
  yield* event("input-read", "completed", input.byteLength + code.byteLength);
  yield* event("request-encode", "entered");
  const wire = yield* Effect.try({
    try: () => encodeJobRequest({ job, input, code }),
    catch: (cause) =>
      withCause(new OfficeInvalid(safeFailure("INVALID_INPUT", job.binding.operationId)), cause),
  });
  yield* event("request-encode", "completed", wire.byteLength);
  yield* event("placement", "entered");
  let pending: Promise<unknown> | null = null;
  const result = yield* Effect.tryPromise({
    try: (signal) => {
      // Recheck immediately before the actual placement, after all input preparation.
      if (Date.now() >= deadlineAt || controller.signal.aborted || signal.aborted) {
        controller.abort();
        throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", job.binding.operationId));
      }
      const running = placement.run(wire, AbortSignal.any([signal, controller.signal]));
      pending = running;
      void running.catch(() => undefined); // Observer only; interruption still joins the original.
      return running;
    },
    catch: (cause) =>
      withCause(
        new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", job.binding.operationId)),
        cause,
      ),
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.promise(async () => {
        reportEvent({ ...diagnostic, phase: "placement-interrupt", reason: "entered" });
        controller.abort();
        await pending;
        reportEvent({ ...diagnostic, phase: "placement-interrupt", reason: "joined" });
      }),
    ),
  );
  yield* event("placement", "completed", result.stdout.byteLength);
  if (result.cleanup !== "confirmed")
    return yield* Effect.fail(
      new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", job.binding.operationId)),
    );
  if (result.status !== "exited" || result.exitCode !== 0) {
    const failureCode =
      result.status === "output-limit"
        ? "LIMIT_EXCEEDED"
        : result.status !== "exited"
          ? "OUTCOME_UNKNOWN"
          : result.exitCode === 2
            ? "INVALID_INPUT"
            : "UNAVAILABLE";
    return yield* Effect.fail(
      failureCode === "INVALID_INPUT" || failureCode === "LIMIT_EXCEEDED"
        ? new OfficeInvalid(safeFailure(failureCode, job.binding.operationId))
        : new OfficeUnavailable(safeFailure(failureCode, job.binding.operationId)),
    );
  }
  yield* event("output-validation", "entered", result.stdout.byteLength);
  const output = yield* Effect.try({
    try: () => validateJobOutput(job, result.stdout),
    catch: (cause) =>
      withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE", job.binding.operationId)), cause),
  });
  yield* event("output-validation", "completed", output.bytes.byteLength);
  yield* event("output-store", "entered", output.bytes.byteLength);
  const id = digestBytes(
    new TextEncoder().encode(
      JSON.stringify([job.binding.ownerDigest, job.binding.jobId, "output-v1"]),
    ),
  );
  const ref: ArtifactRef = yield* bytes.put(owner, {
    id,
    kind: output.kind,
    mediaType: output.mediaType,
    declaredBytes: output.bytes.byteLength,
    expectedDigest: digestBytes(output.bytes),
    body: byteStream(output.bytes),
  });
  if (
    ref.id !== id ||
    ref.kind !== output.kind ||
    ref.mediaType !== output.mediaType ||
    ref.bytes !== output.bytes.byteLength ||
    ref.digest !== digestBytes(output.bytes)
  )
    return yield* Effect.fail(
      new OfficeInvalid(safeFailure("INVALID_INPUT", job.binding.operationId)),
    );
  yield* event("output-store", "completed", ref.bytes);
  return ref;
});
