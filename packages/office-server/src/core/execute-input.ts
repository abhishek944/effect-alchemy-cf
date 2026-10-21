import { randomUUID } from "node:crypto";
import { Clock, Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type {
  ExecutionBinding,
  IsolatedJob,
  JobRecord,
  OfficeDependencies,
  OperationRecord,
} from "../ports/index.ts";
import { ownerDigest, snapshotDigest, JOB_NATIVE_LIMITS } from "../jobs/frames.ts";
import { materializeNativeSnapshot } from "./input.ts";
import { stageNativeArtifact } from "./bytes.ts";
import { advanceOperation } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { operationTarget } from "./operation-caller.ts";
import { verifyOperation } from "./claims.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { StoredArtifact } from "./record-schemas.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";

type ExecuteJob = Extract<IsolatedJob, { kind: "execute" }>;
export const executionJob = Effect.fn("Office.executionJob")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (original.intent.kind !== "execute" || original.worktreeId === null)
    return yield* Effect.fail(officeFailure("INVALID_INPUT", original.receipt.operationId));
  const input = original.intent.input;
  const worktreeId = original.worktreeId;
  let record = original;
  const target = {
    owner: record.owner,
    documentId: record.documentId,
    unitId: record.unitId,
    scope: {
      kind: "draft" as const,
      draftId: input.target.draftId,
      generation: input.target.generation,
    },
  };
  if (record.jobId === null) {
    record = yield* deps.authority.serial(
      target,
      {
        operationId: input.operationId,
        expectedHead: input.target.expectedRevision,
        reviewFingerprint: null,
        purpose: "metadata",
      },
      () =>
        Effect.gen(function* () {
          yield* verifyOperation(deps, original, target, phase);
          const current = yield* operationRecord(deps, original.owner, input.operationId);
          if (current === null)
            return yield* Effect.fail(officeFailure("NOT_FOUND", input.operationId));
          if (current.jobId !== null) return current;
          return yield* advanceOperation(deps, current, "reserved", { jobId: randomUUID() });
        }),
    );
  }
  const jobId = record.jobId;
  if (jobId === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
  const existing = yield* deps.metadata.job(record.owner, jobId);
  if (existing !== null) {
    const job = existing.job;
    if (
      job.kind !== "execute" ||
      job.binding.jobId !== jobId ||
      job.binding.operationId !== input.operationId ||
      job.binding.ownerDigest !== ownerDigest(record.owner) ||
      job.binding.documentId !== record.documentId ||
      job.binding.unitId !== record.unitId ||
      job.binding.generation !== input.target.generation ||
      job.binding.baseRevision !== input.target.expectedRevision ||
      job.code.id !== input.codeId ||
      job.binding.policyVersion !== record.policyVersion
    )
      return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
    yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
    if (record.artifacts.input === null)
      record = yield* advanceOperation(deps, record, "input-pinned", {
        artifacts: { ...record.artifacts, input: job.input, code: job.code },
      });
    return { record, job };
  }
  if (record.receipt.phase !== "reserved")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", input.operationId));
  const source = yield* deps.bytes.get(record.owner, input.codeId);
  if (source === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
  yield* nativeCall(() => source.body.cancel());
  const code = yield* decodeWire(StoredArtifact)(source.ref).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", input.operationId)),
  );
  if (code.kind !== "code" || code.bytes > deps.policy.limits.codeBytes)
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", input.operationId));
  const document = yield* deps.metadata.document(record.owner, record.documentId);
  if (document === null || record.worktreeId !== worktreeId)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
  const epochs = yield* deps.authority.current(record.owner, record.documentId);
  const native = yield* materializeNativeSnapshot(
    deps,
    runtime,
    { kind: "read", target, ...epochs },
    worktreeId,
    document.document.kind,
    input.target.expectedRevision,
  );
  const digest = yield* Effect.try({
    try: () => snapshotDigest(native),
    catch: () => officeFailure("LIMIT_EXCEEDED"),
  });
  const binding: ExecutionBinding = {
    version: 1,
    jobId,
    operationId: input.operationId,
    ownerDigest: ownerDigest(record.owner),
    documentId: record.documentId,
    unitId: record.unitId,
    kind: document.document.kind,
    generation: input.target.generation,
    baseRevision: input.target.expectedRevision,
    inputDigest: digest,
    codeDigest: code.digest,
    policyVersion: deps.policy.version,
    imageDigest: deps.policy.imageDigest,
    codec: NATIVE_WIRE_CODEC,
  };
  const artifact = yield* stageNativeArtifact(
    deps,
    record.owner,
    "native-input",
    "job-input",
    { binding, native },
    Math.min(deps.policy.limits.nativeBytes, JOB_NATIVE_LIMITS.maxBytes),
  );
  const job: ExecuteJob = { kind: "execute", binding, input: artifact, code, target: input.target };
  const now = yield* Clock.currentTimeMillis;
  const queued: JobRecord = {
    owner: record.owner,
    job,
    state: { state: "queued", jobId },
    version: 0,
    dispatch: null,
    createdAt: now,
    updatedAt: now,
  };
  yield* verifyOperation(deps, record, target, phase);
  const saved = yield* deps.metadata.reserveJob(queued);
  if (saved.job.kind !== "execute")
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
  yield* verifyOperation(deps, record, target, "recovery-observe");
  record = yield* advanceOperation(deps, record, "input-pinned", {
    artifacts: { ...record.artifacts, input: saved.job.input, code: saved.job.code },
  });
  return { record, job: saved.job };
});
