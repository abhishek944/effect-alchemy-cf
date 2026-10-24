import { Effect, ErrorReporter } from "effect";
import {
  withCause,
  withDiagnostic,
  reportEventEffect,
  reportedFailure,
} from "@starter/diagnostics";
import { officeReportBranch } from "./office-diagnostic-report.ts";
import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { createOfficeMetadata } from "@starter/office-cloudflare/metadata";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import { officeJobProcess } from "./office-job-process.ts";

const unknown = (cause?: unknown) => {
  const error = withCause(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")), cause);
  return ErrorReporter.isIgnored(cause) ? reportedFailure(error) : error;
};
/** Separate fresh role/instance in the SAME namespace/application image, never the warm host. */
export function officeJobRole(
  state: cf.DurableObjectState,
  image: string,
  resources: OfficeProviderOptions,
  owner: OwnerScope,
  jobId: string,
  nodeId: string,
) {
  const context = {
    component: "office.job-role",
    operation: "admission",
    jobId,
    stage: owner.stage,
    service: "office",
    release: image.slice(-64),
  };
  const rejected = (reason: string, cause?: unknown) =>
    officeReportBranch(withDiagnostic(unknown(cause), reason), {
      ...context,
      reason,
      outcome: "not-submitted",
    });
  let process: ReturnType<typeof officeJobProcess>;
  try {
    process = officeJobProcess(state, image, owner.stage);
  } catch (cause) {
    throw rejected("job-process-configuration", cause);
  }
  const metadata = createOfficeMetadata(resources);
  let issued = false;
  return {
    runJob: (body: ReadableStream<unknown>) =>
      Effect.gen(function* () {
        if (issued) return yield* Effect.fail(rejected("job-already-issued"));
        issued = true;
        const claim = yield* metadata.job(owner, jobId).pipe(
          Effect.mapError((error) =>
            officeReportBranch(error, {
              ...context,
              reason: "job-claim-read",
              outcome: "not-submitted",
            }),
          ),
        );
        if (claim === null || claim.version !== 1 || claim.state.state !== "running")
          return yield* Effect.fail(rejected("job-claim-not-running"));
        const dispatch = claim.dispatch;
        if (
          dispatch === null ||
          dispatch.workerId !== nodeId ||
          dispatch.deadlineAt <= Date.now() ||
          claim.job.binding.imageDigest !== image.slice(image.lastIndexOf("@") + 1)
        )
          return yield* Effect.fail(
            rejected(
              dispatch === null
                ? "job-dispatch-missing"
                : dispatch.workerId !== nodeId
                  ? "job-worker-mismatch"
                  : dispatch.deadlineAt <= Date.now()
                    ? "job-deadline-expired"
                    : "job-image-mismatch",
            ),
          );
        yield* reportEventEffect({
          component: "office.job-role",
          operation: "claim",
          phase: "claim-validated",
          outcome: "confirmed",
          operationId: claim.job.binding.operationId,
          jobId,
          taskId: jobId,
          deadlineAt: dispatch.deadlineAt,
        });
        // Physical joins belong to status()/close(); a blocking request-scope finalizer would withhold
        // the response body and self-deadlock the Worker that must consume it.
        const actual = yield* Effect.tryPromise({
          try: (signal) =>
            process.run(body, signal, dispatch.deadlineAt, {
              operationId: claim.job.binding.operationId,
              taskId: claim.job.binding.jobId,
            }),
          catch: unknown,
        });
        return actual.body;
      }),
    jobStatus: (cancel: boolean) =>
      Effect.tryPromise({
        try: async () => {
          if (cancel) {
            issued = true;
            await process.close();
          }
          return process.status();
        },
        catch: unknown,
      }),
    close: () => process.close(),
  };
}
export type OfficeJobRole = ReturnType<typeof officeJobRole>;
