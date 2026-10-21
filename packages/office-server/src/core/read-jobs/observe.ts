import { Effect } from "effect";
import type { Actor, OfficeDependencies, OperationRecord } from "../../ports/index.ts";
import { artifactKey } from "../../jobs/artifacts.ts";
import { requireJobIdentity, requireJobRecord } from "../../jobs/identity.ts";
import { verifyOperation } from "../claims.ts";
import { officeFailure } from "../failure.ts";
import { storeJobState } from "../job-state.ts";
import { operationCaller, operationTarget } from "../operation-caller.ts";
import { boundedMetadataDigest, terminalReceipt } from "../operations.ts";
import { requireIntent } from "../operation-read.ts";
import { finishReadOutput } from "./publish.ts";

const originalJob = Effect.fn("Office.readJobs.originalJob")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  if (record.jobId === null || record.artifacts.input === null) return null;
  const intent = record.intent;
  if (intent.kind !== "render" && intent.kind !== "export")
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const saved = yield* deps.metadata.job(record.owner, record.jobId);
  if (saved === null) return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN"));
  yield* Effect.try({
    try: () => {
      requireJobRecord(record.owner, saved);
      requireJobIdentity(record.owner, saved.job, deps.policy.imageDigest, deps.policy.version);
    },
    catch: () => officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId),
  });
  const job = saved.job;
  if (job.kind === "execute" || job.kind === "import" || job.kind === "inspect")
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT"));
  const binding = job.binding;
  if (
    job.kind !== intent.kind ||
    binding.jobId !== record.jobId ||
    binding.operationId !== record.receipt.operationId ||
    binding.documentId !== record.documentId ||
    binding.unitId !== record.unitId ||
    binding.policyVersion !== record.policyVersion ||
    (binding.generation === null) !== (record.worktreeId === null) ||
    artifactKey(job.input) !== artifactKey(record.artifacts.input)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  const expected =
    intent.kind === "render"
      ? { kind: "render", selection: intent.input.selection }
      : { kind: "export", options: intent.input.options };
  const actual =
    job.kind === "render"
      ? { kind: "render", selection: job.selection }
      : { kind: "export", options: job.options };
  if (
    (yield* boundedMetadataDigest(expected, deps.policy.limits.metadataBytes)) !==
    (yield* boundedMetadataDigest(actual, deps.policy.limits.metadataBytes))
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  return job;
});

/** Original outcome observation only: no View acquisition, actor fabrication, preparation or submission. */
export const observeReadOutput = Effect.fn("Office.readJobs.observeOutput")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  original: OperationRecord,
) {
  if (original.intent.kind !== "render" && original.intent.kind !== "export")
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const context = yield* operationCaller(deps, actor, original.receipt.operationId, "receipt");
  const record = context.record;
  if (record === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  yield* requireIntent(deps, record, original.intent);
  if (terminalReceipt(record.receipt.phase)) return record.receipt;
  const target = yield* operationTarget(deps, record);
  const revalidate = () => verifyOperation(deps, record, target, "recovery-observe");
  yield* revalidate();
  const job = yield* originalJob(deps, record);
  if (job === null) return record.receipt;
  const state = yield* deps.jobs.status(record.owner, job.binding.jobId);
  if (
    state.jobId !== job.binding.jobId ||
    (state.state === "succeeded" && state.inputDigest !== job.binding.inputDigest)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  yield* revalidate();
  const current = yield* storeJobState(deps, record, job, state);
  if (
    terminalReceipt(current.receipt.phase) ||
    current.receipt.phase === "execution-unknown" ||
    current.receipt.phase === "needs-attention" ||
    state.state !== "succeeded"
  )
    return current.receipt;
  return yield* finishReadOutput(deps, target, current, job, state.output, revalidate);
});
