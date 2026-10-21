import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import { decodeNativeFrame, encodeNativeFrame } from "@starter/office-contract/native-wire";
import type { IsolatedJob, JobState, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import { ImportedOutputSchema } from "../jobs/output.ts";
import { JOB_OUTPUT_LIMITS, requireBinding, requireSnapshot } from "../jobs/frames.ts";
import { stageNativeArtifact, readArtifact } from "./bytes.ts";
import { sha256, advanceOperation } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { officeFailure } from "./failure.ts";
import { operationTarget } from "./operation-caller.ts";
import { verifyOperation } from "./claims.ts";

export const stageImportedSeed = Effect.fn("Office.stageImportedSeed")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  job: Extract<IsolatedJob, { kind: "import" }>,
  state: Extract<JobState, { state: "succeeded" }>,
) {
  if (state.jobId !== job.binding.jobId || state.inputDigest !== job.binding.inputDigest)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", original.receipt.operationId));
  const bytes = yield* readArtifact(deps, original.owner, state.output, JOB_OUTPUT_LIMITS.maxBytes);
  const payload = yield* Effect.try({
    try: () => decodeNativeFrame(bytes, "job-output", JOB_OUTPUT_LIMITS).payload,
    catch: () => officeFailure("CONTENT_REQUIRED", original.receipt.operationId),
  });
  const output = yield* decodeWire(ImportedOutputSchema)(payload).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  yield* Effect.try({
    try: () => {
      requireBinding(output.binding, job.binding);
      requireSnapshot(output.native, job.binding);
    },
    catch: () => officeFailure("CONTENT_REQUIRED", original.receipt.operationId),
  });
  if (output.native.snapshot.rev !== 1)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  const encoded = yield* Effect.try({
    try: () => encodeNativeFrame("snapshot", output.native),
    catch: () => officeFailure("LIMIT_EXCEEDED"),
  });
  const digest = sha256(encoded);
  let record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  if (record.artifacts.proposal === null) {
    const ref = yield* stageNativeArtifact(
      deps,
      original.owner,
      "native-input",
      "snapshot",
      output.native,
    );
    yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
    record = yield* advanceOperation(deps, record, "proposal-staged", {
      artifacts: { ...record.artifacts, proposal: ref },
    });
  }
  const ref = record.artifacts.proposal;
  if (
    ref === null ||
    ref.kind !== "native-input" ||
    ref.digest !== digest ||
    ref.bytes !== encoded.byteLength
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", original.receipt.operationId));
  yield* readArtifact(deps, record.owner, ref, deps.policy.limits.nativeBytes);
  return { record, native: output.native };
});
