import { Clock, Effect } from "effect";
import type { ExportOptions, InspectQuery, RenderSelection } from "@starter/office-contract";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type {
  Actor,
  IsolatedJob,
  JobBinding,
  JobRecord,
  OfficeDependencies,
  ViewRecord,
} from "../../ports/index.ts";
import { JOB_NATIVE_LIMITS, ownerDigest, snapshotDigest } from "../../jobs/frames.ts";
import { requireJobIdentity, requireJobRecord } from "../../jobs/identity.ts";
import { stageNativeArtifact } from "../bytes.ts";
import { officeFailure } from "../failure.ts";
import { materializeView } from "../input.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { boundedMetadataDigest } from "../operations.ts";
import { lookupView } from "../views.ts";

export type ReadSpec =
  | { readonly kind: "inspect"; readonly viewId: string; readonly query: InspectQuery }
  | { readonly kind: "render"; readonly selection: RenderSelection }
  | { readonly kind: "export"; readonly options: ExportOptions };
export type ReadJob = Exclude<IsolatedJob, { kind: "execute" | "import" }>;
export const viewIdentity = (view: ViewRecord) => [
  view.owner,
  view.target,
  view.authorityEpoch,
  view.serviceEpoch,
  view.source,
  view.view.id,
  view.view.kind,
  view.view.revision,
  view.view.nativeTarget,
];
export const freshView = Effect.fn("Office.readJobs.freshView")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  original: ViewRecord,
) {
  const current = yield* lookupView(deps, actor, original.view.id);
  const before = yield* boundedMetadataDigest(
    viewIdentity(original),
    deps.policy.limits.metadataBytes,
  );
  const after = yield* boundedMetadataDigest(
    viewIdentity(current),
    deps.policy.limits.metadataBytes,
  );
  if (before !== after) return yield* Effect.fail(officeFailure("STALE_BASIS"));
  return current;
});
const specOf = (job: ReadJob): ReadSpec => {
  if (job.kind === "inspect") return { kind: "inspect", viewId: job.viewId, query: job.query };
  if (job.kind === "render") return { kind: "render", selection: job.selection };
  return { kind: "export", options: job.options };
};
export const existingReadJob = Effect.fn("Office.readJobs.existing")(function* (
  deps: OfficeDependencies,
  view: ViewRecord,
  spec: ReadSpec,
  jobId: string,
  operationId: string,
) {
  const saved = yield* deps.metadata.job(view.owner, jobId);
  if (saved === null) return null;
  const job = saved.job,
    b = job.binding,
    scope = view.target.scope;
  yield* Effect.try({
    try: () => {
      requireJobRecord(view.owner, saved);
      requireJobIdentity(view.owner, job, deps.policy.imageDigest, deps.policy.version);
    },
    catch: () => officeFailure("IDEMPOTENCY_CONFLICT", operationId),
  });
  if (
    job.kind === "execute" ||
    job.kind === "import" ||
    job.kind !== spec.kind ||
    b.jobId !== jobId ||
    b.operationId !== operationId ||
    b.documentId !== view.target.documentId ||
    b.unitId !== view.target.unitId ||
    b.kind !== view.view.kind ||
    b.baseRevision !== view.view.revision ||
    b.generation !== (scope.kind === "draft" ? scope.generation : null)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  const expected = yield* boundedMetadataDigest(spec, deps.policy.limits.metadataBytes);
  const actual = yield* boundedMetadataDigest(specOf(job), deps.policy.limits.metadataBytes);
  if (actual !== expected)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  return { saved, job };
});
export const prepareReadJob = Effect.fn("Office.readJobs.prepare")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  view: ViewRecord,
  spec: ReadSpec,
  jobId: string,
  operationId: string,
) {
  const existing = yield* existingReadJob(deps, view, spec, jobId, operationId);
  if (existing !== null) return existing;
  yield* freshView(deps, actor, view);
  const native = yield* materializeView(deps, runtime, view);
  const inputDigest = yield* Effect.try({
    try: () => snapshotDigest(native),
    catch: () => officeFailure("LIMIT_EXCEEDED", operationId),
  });
  yield* freshView(deps, actor, view);
  const scope = view.target.scope;
  const binding: JobBinding = {
    version: 1,
    jobId,
    operationId,
    ownerDigest: ownerDigest(view.owner),
    documentId: view.target.documentId,
    unitId: view.target.unitId,
    kind: view.view.kind,
    generation: scope.kind === "draft" ? scope.generation : null,
    baseRevision: view.view.revision,
    inputDigest,
    codeDigest: null,
    policyVersion: deps.policy.version,
    imageDigest: deps.policy.imageDigest,
    codec: NATIVE_WIRE_CODEC,
  };
  const input = yield* stageNativeArtifact(
    deps,
    view.owner,
    "native-input",
    "job-input",
    { binding, native },
    Math.min(deps.policy.limits.nativeBytes, JOB_NATIVE_LIMITS.maxBytes),
  );
  const job: ReadJob = { ...spec, binding, input };
  const now = yield* Clock.currentTimeMillis;
  const queued: JobRecord = {
    owner: view.owner,
    job,
    state: { state: "queued", jobId },
    version: 0,
    dispatch: null,
    createdAt: now,
    updatedAt: now,
  };
  yield* deps.metadata
    .reserveJob(queued)
    .pipe(
      Effect.catch((error) =>
        error.code === "IDEMPOTENCY_CONFLICT" || error.code === "NATIVE_CONFLICT"
          ? Effect.succeed(null)
          : Effect.fail(error),
      ),
    );
  const chosen = yield* existingReadJob(deps, view, spec, jobId, operationId);
  if (chosen === null) return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", operationId));
  if (chosen.job.binding.inputDigest !== binding.inputDigest)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  return chosen;
});
export const observeReadJob = Effect.fn("Office.readJobs.observe")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  view: ViewRecord,
  job: ReadJob,
) {
  yield* freshView(deps, actor, view);
  const saved = yield* deps.metadata.job(view.owner, job.binding.jobId);
  if (saved === null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", job.binding.operationId));
  yield* Effect.try({
    try: () => requireJobRecord(view.owner, saved, job),
    catch: () => officeFailure("IDEMPOTENCY_CONFLICT", job.binding.operationId),
  });
  const state =
    saved.state.state === "queued" && saved.version === 0 && saved.dispatch === null
      ? yield* deps.jobs
          .submit(view.owner, job)
          .pipe(
            Effect.catch((error) =>
              error.code === "BUSY" ? Effect.succeed(saved.state) : Effect.fail(error),
            ),
          )
      : yield* deps.jobs.status(view.owner, job.binding.jobId);
  if (
    state.jobId !== job.binding.jobId ||
    (state.state === "succeeded" && state.inputDigest !== job.binding.inputDigest)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", job.binding.operationId));
  yield* freshView(deps, actor, view);
  return state;
});
