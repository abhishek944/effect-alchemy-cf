import { Clock, Effect } from "effect";
import { withCause, reportFailureEffect } from "@starter/diagnostics";
import {
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type ArtifactRef,
} from "@starter/office-contract";
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
        Effect.fail(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN", job.binding.operationId))),
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
      }).pipe(
        Effect.as(
          error.code === "OUTCOME_UNKNOWN"
            ? unknownJobState(job)
            : {
                state: "failed" as const,
                jobId: job.binding.jobId,
                error: {
                  ...safeFailure(error.code, job.binding.operationId),
                  retry: "never" as const,
                },
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
  const input = yield* readJobArtifact(
    bytes,
    owner,
    job.input,
    job.kind === "import" ? 10 * 1024 * 1024 : 32 * 1024 * 1024,
    controller.signal,
  );
  const code =
    job.kind === "execute"
      ? yield* readJobArtifact(bytes, owner, job.code, 32 * 1024, controller.signal)
      : new Uint8Array();
  const wire = yield* Effect.try({
    try: () => encodeJobRequest({ job, input, code }),
    catch: (cause) =>
      withCause(new OfficeInvalid(safeFailure("INVALID_INPUT", job.binding.operationId)), cause),
  });
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
        controller.abort();
        await pending;
      }),
    ),
  );
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
        ? new OfficeInvalid({
            ...safeFailure(failureCode, job.binding.operationId),
            retry: "never",
          })
        : new OfficeUnavailable({
            ...safeFailure(failureCode, job.binding.operationId),
            retry: "never",
          }),
    );
  }
  const output = yield* Effect.try({
    try: () => validateJobOutput(job, result.stdout),
    catch: (cause) =>
      withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE", job.binding.operationId)), cause),
  });
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
  return ref;
});
