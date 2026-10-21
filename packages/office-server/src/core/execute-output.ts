import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { IsolatedJob, JobState, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import { decodeJobInput, decodeMutationCandidate, JOB_NATIVE_LIMITS } from "../jobs/frames.ts";
import { validateMutationCandidate } from "../jobs/validate.ts";
import { readArtifact, stageNativeArtifact } from "./bytes.ts";
import { advanceOperation } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { operationTarget } from "./operation-caller.ts";
import { verifyOperation } from "./claims.ts";
import { readProposal } from "./proposal.ts";

type ExecuteJob = Extract<IsolatedJob, { kind: "execute" }>;
export const executionStatus = Effect.fn("Office.executionStatus")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  job: ExecuteJob,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  const saved = yield* deps.metadata.job(record.owner, job.binding.jobId);
  if (saved === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", job.binding.operationId));
  if (submit && saved.state.state === "queued" && saved.version === 0 && saved.dispatch === null) {
    const target = {
      owner: record.owner,
      documentId: record.documentId,
      unitId: record.unitId,
      scope: {
        kind: "draft" as const,
        draftId: job.target.draftId,
        generation: job.target.generation,
      },
    };
    yield* verifyOperation(deps, record, target, phase);
    const state = yield* deps.jobs.submit(record.owner, job);
    if (state.jobId !== job.binding.jobId)
      return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
    if (state.state === "queued")
      return yield* Effect.fail(officeFailure("BUSY", record.receipt.operationId));
    return state;
  }
  return yield* deps.jobs.status(record.owner, job.binding.jobId);
});
export const stageExecutionProposal = Effect.fn("Office.stageExecutionProposal")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  job: ExecuteJob,
  state: Extract<JobState, { state: "succeeded" }>,
) {
  if (state.jobId !== job.binding.jobId || state.inputDigest !== job.binding.inputDigest)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  if (record.artifacts.proposal !== null)
    return {
      record,
      proposal: yield* readProposal(deps, record.owner, record.artifacts.proposal, job.binding),
    };
  const inputBytes = yield* readArtifact(deps, record.owner, job.input, JOB_NATIVE_LIMITS.maxBytes);
  const input = yield* Effect.try({
    try: () => decodeJobInput(inputBytes, job.binding),
    catch: () => officeFailure("CONTENT_REQUIRED", record.receipt.operationId),
  });
  const candidateBytes = yield* readArtifact(
    deps,
    record.owner,
    state.output,
    deps.policy.limits.proposalBytes,
  );
  const candidate = yield* Effect.try({
    try: () => decodeMutationCandidate(candidateBytes, job.binding),
    catch: () => officeFailure("INVALID_INPUT", record.receipt.operationId),
  });
  if (candidate.mutations.length > deps.policy.limits.mutationCount)
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", record.receipt.operationId));
  const proposal = yield* nativeCall(() =>
    validateMutationCandidate(input, candidate, {
      userId: record.owner.ownerId,
      memberId: randomUUID(),
      sid: randomUUID(),
      reqId: 1,
    }),
  );
  const ref = yield* stageNativeArtifact(
    deps,
    record.owner,
    "native-proposal",
    "proposal",
    proposal,
    deps.policy.limits.proposalBytes,
  );
  const current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
  yield* verifyOperation(deps, current, yield* operationTarget(deps, current), "recovery-observe");
  if (current.artifacts.proposal !== null)
    return {
      record: current,
      proposal: yield* readProposal(deps, record.owner, current.artifacts.proposal, job.binding),
    };
  const updated = yield* advanceOperation(deps, current, "proposal-staged", {
    artifacts: { ...current.artifacts, source: state.output, proposal: ref },
  });
  return { record: updated, proposal };
});
