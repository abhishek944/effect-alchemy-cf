import { Effect } from "effect";
import { safeFailure, type ArtifactRef, type OfficeError } from "@starter/office-contract";
import type {
  Actor,
  NativeTarget,
  OfficeDependencies,
  OperationRecord,
  ViewRecord,
} from "../../ports/index.ts";
import { artifactKey } from "../../jobs/artifacts.ts";
import { verifyOperation } from "../claims.ts";
import { officeFailure } from "../failure.ts";
import { operationRecord } from "../operation-read.ts";
import { advanceOperation, terminalReceipt } from "../operations.ts";
import { freshView, observeReadJob } from "./job.ts";
import type { ReadJob } from "./job.ts";
import { ordinaryJobOutput } from "./output.ts";

/** One normalization/final-receipt policy for fresh admission and exact accepted-outcome recovery. */
export const finishReadOutput = Effect.fn("Office.readJobs.finish")(function* (
  deps: OfficeDependencies,
  target: NativeTarget,
  record: OperationRecord,
  job: Exclude<ReadJob, { kind: "inspect" }>,
  output: ArtifactRef,
  revalidate: () => Effect.Effect<void, OfficeError>,
) {
  yield* revalidate();
  const normalized = yield* ordinaryJobOutput(deps, record.owner, job, output).pipe(
    Effect.map((artifact) => ({ kind: "ready" as const, artifact })),
    Effect.catch((error) =>
      error.code === "LIMIT_EXCEEDED" || error.code === "INVALID_INPUT"
        ? Effect.succeed({ kind: "rejected" as const, error })
        : Effect.fail(error),
    ),
  );
  return yield* deps.authority.serial(
    target,
    {
      operationId: record.receipt.operationId,
      expectedHead: null,
      reviewFingerprint: null,
      purpose: "metadata",
    },
    () =>
      Effect.gen(function* () {
        yield* revalidate();
        const latest = yield* operationRecord(deps, record.owner, record.receipt.operationId);
        if (latest === null)
          return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
        if (terminalReceipt(latest.receipt.phase)) return latest.receipt;
        if (
          latest.receipt.phase !== "running" ||
          latest.jobId !== job.binding.jobId ||
          latest.intentDigest !== record.intentDigest ||
          latest.lineageDigest !== record.lineageDigest ||
          latest.artifacts.input === null ||
          artifactKey(latest.artifacts.input) !== artifactKey(job.input)
        )
          return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
        return (yield* advanceOperation(
          deps,
          latest,
          normalized.kind === "rejected" ? "failed-before-submit" : "confirmed",
          {},
          normalized.kind === "rejected"
            ? { error: safeFailure(normalized.error.code, latest.receipt.operationId) }
            : { artifact: normalized.artifact, error: null, acceptedRevision: null },
        )).receipt;
      }),
  );
});

export const publishReadOutput = Effect.fn("Office.readJobs.publish")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  view: ViewRecord,
  initial: OperationRecord,
  job: Exclude<ReadJob, { kind: "inspect" }>,
) {
  yield* verifyOperation(deps, initial, view.target, "final-commit");
  const state = yield* observeReadJob(deps, actor, view, job);
  const current = yield* operationRecord(deps, initial.owner, initial.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", initial.receipt.operationId));
  yield* verifyOperation(deps, current, view.target, "final-commit");
  let record = current;
  if (
    terminalReceipt(record.receipt.phase) ||
    record.receipt.phase === "execution-unknown" ||
    record.receipt.phase === "needs-attention"
  )
    return record.receipt;
  if (state.state === "queued") return record.receipt;
  if (record.receipt.phase === "queued") record = yield* advanceOperation(deps, record, "running");
  if (record.receipt.phase !== "running")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  if (state.state === "running") return record.receipt;
  if (state.state === "failed" || state.state === "execution-unknown")
    return (yield* advanceOperation(
      deps,
      record,
      state.state === "failed" ? "failed-before-submit" : "execution-unknown",
      {},
      { error: safeFailure(state.error.code, record.receipt.operationId) },
    )).receipt;
  if (state.state !== "succeeded")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  return yield* finishReadOutput(deps, view.target, record, job, state.output, () =>
    Effect.gen(function* () {
      yield* freshView(deps, actor, view);
      yield* verifyOperation(deps, record, view.target, "final-commit");
    }),
  );
});
