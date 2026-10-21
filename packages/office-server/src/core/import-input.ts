import { Clock, Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type {
  IsolatedJob,
  JobRecord,
  OfficeDependencies,
  OperationRecord,
} from "../ports/index.ts";
import { IsolatedJobSchema } from "../jobs/schemas.ts";
import { ownerDigest } from "../jobs/frames.ts";
import { requireJobRecord } from "../jobs/identity.ts";
import { artifactKey } from "../jobs/artifacts.ts";
import { StoredArtifact } from "./record-schemas.ts";
import { advanceOperation, metadataDigest } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { verifyOperation } from "./claims.ts";
import { operationTarget } from "./operation-caller.ts";
import { nativeCall, officeFailure } from "./failure.ts";

type ImportJob = Extract<IsolatedJob, { kind: "import" }>;
export const importJob = Effect.fn("Office.importJob")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  const into = original.intent.kind === "import-into" ? original.intent.input : null;
  const source =
    into !== null
      ? { uploadId: into.source.id, options: into.options }
      : original.intent.kind === "create" && original.intent.input.source.kind === "office"
        ? original.intent.input.source
        : null;
  if (source === null) return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const stored = yield* deps.bytes.get(original.owner, source.uploadId);
  if (stored === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  yield* nativeCall(() => stored.body.cancel());
  const upload = yield* decodeWire(StoredArtifact)(stored.ref).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    upload.id !== source.uploadId ||
    upload.kind !== "upload" ||
    upload.bytes > deps.policy.limits.uploadBytes ||
    (into !== null && artifactKey(upload) !== artifactKey(into.source))
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  const jobId = metadataDigest(
    [
      "office-import-job",
      1,
      original.owner.stage,
      original.owner.ownerId,
      original.receipt.operationId,
    ],
    4096,
  );
  if (original.jobId !== null && original.jobId !== jobId)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", original.receipt.operationId));
  const job: ImportJob = {
    kind: "import",
    input: upload,
    filename: `office-upload.${source.options.format}`,
    options: source.options,
    binding: {
      version: 1,
      jobId,
      operationId: original.receipt.operationId,
      ownerDigest: ownerDigest(original.owner),
      documentId: original.documentId,
      unitId:
        into === null
          ? original.unitId
          : metadataDigest(
              [
                "office-import-source",
                1,
                original.owner.stage,
                original.owner.ownerId,
                original.receipt.operationId,
                upload.digest,
              ],
              4096,
            ),
      kind: source.options.kind,
      generation:
        into !== null
          ? into.target.generation
          : original.intent.kind === "create" && original.intent.input.destination === "main"
            ? null
            : 1,
      baseRevision: null,
      inputDigest: upload.digest,
      codeDigest: null,
      policyVersion: original.policyVersion,
      imageDigest: deps.policy.imageDigest,
      codec: "office-native-msgpack-v1",
    },
  };
  yield* decodeWire(IsolatedJobSchema)(job).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  const previous = yield* deps.metadata.job(original.owner, jobId);
  let saved = previous;
  if (saved === null) {
    if (original.receipt.phase !== "reserved")
      return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", original.receipt.operationId));
    yield* verifyOperation(deps, original, yield* operationTarget(deps, original), phase);
    const now = yield* Clock.currentTimeMillis;
    const initial: JobRecord = {
      owner: original.owner,
      job,
      state: { state: "queued", jobId },
      version: 0,
      dispatch: null,
      createdAt: now,
      updatedAt: now,
    };
    saved = yield* deps.metadata.reserveJob(initial);
  }
  yield* Effect.try({
    try: () => requireJobRecord(original.owner, saved, job),
    catch: () => officeFailure("IDEMPOTENCY_CONFLICT"),
  });
  let record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  if (record.receipt.phase === "reserved")
    record = yield* advanceOperation(deps, record, "input-pinned", {
      jobId,
      artifacts: {
        ...record.artifacts,
        source: upload,
        input: into === null ? upload : record.artifacts.input,
      },
    });
  if (record.jobId !== jobId || record.artifacts.source?.digest !== upload.digest)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", original.receipt.operationId));
  return { record, job, saved };
});
export const importStatus = Effect.fn("Office.importStatus")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  job: ImportJob,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch",
) {
  const saved = yield* deps.metadata.job(record.owner, job.binding.jobId);
  if (saved === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (submit && saved.state.state === "queued" && saved.version === 0 && saved.dispatch === null) {
    yield* verifyOperation(deps, record, yield* operationTarget(deps, record), phase);
    const state = yield* deps.jobs.submit(record.owner, job);
    if (state.state === "queued")
      return yield* Effect.fail(officeFailure("BUSY", record.receipt.operationId));
    return state;
  }
  return yield* deps.jobs.status(record.owner, job.binding.jobId);
});
