import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OperationIntent, ViewRecord } from "../../ports/index.ts";
import { artifactKey } from "../../jobs/artifacts.ts";
import { authorize, verifyOperation } from "../claims.ts";
import { officeFailure } from "../failure.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { operationRecord } from "../operation-read.ts";
import { operationCaller } from "../operation-caller.ts";
import {
  advanceOperation,
  boundedMetadataDigest,
  reserveOperation,
  terminalReceipt,
} from "../operations.ts";
import { StoredDraft } from "../record-schemas.ts";
import { resolveTarget } from "../target.ts";
import { lookupView } from "../views.ts";
import { existingReadJob, prepareReadJob } from "./job.ts";
import type { ReadSpec } from "./job.ts";
import { publishReadOutput } from "./publish.ts";
import { observeReadOutput } from "./observe.ts";

type OutputIntent = Extract<OperationIntent, { kind: "render" | "export" }>;
const draftForView = Effect.fn("Office.readJobs.draft")(function* (
  deps: OfficeDependencies,
  view: ViewRecord,
) {
  if (view.target.scope.kind === "main") return null;
  const raw = yield* deps.metadata.draft(view.owner, view.target.scope.draftId);
  if (raw === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const draft = yield* decodeWire(StoredDraft)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    draft.documentId !== view.target.documentId ||
    draft.generation !== view.target.scope.generation ||
    (view.source.kind === "draft" && draft.worktreeId !== view.source.worktreeId)
  )
    return yield* Effect.fail(officeFailure("STALE_BASIS"));
  return draft;
});
export const outputOperation = Effect.fn("Office.readJobs.operation")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  intent: OutputIntent,
) {
  const input = intent.input,
    operationId = input.operationId;
  const context = yield* operationCaller(deps, actor, operationId, intent);
  let record = context.record;
  if (record !== null && terminalReceipt(record.receipt.phase)) return record.receipt;
  if (actor.capability === "recovery") {
    if (record === null) return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
    return yield* observeReadOutput(deps, actor, record);
  }
  const view = yield* lookupView(deps, actor, input.viewId);
  const spec: ReadSpec =
    intent.kind === "render"
      ? { kind: "render", selection: intent.input.selection }
      : { kind: "export", options: intent.input.options };
  const selectedKind =
    spec.kind === "render"
      ? spec.selection.kind
      : spec.kind === "export"
        ? spec.options.kind
        : null;
  if (selectedKind !== view.view.kind)
    return yield* Effect.fail(officeFailure("INVALID_INPUT", operationId));
  if (
    spec.kind === "render" &&
    spec.selection.kind !== "sheet" &&
    (spec.selection.pages.length > deps.policy.limits.renderPages ||
      new Set<string | number>(spec.selection.pages).size !== spec.selection.pages.length)
  )
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", operationId));
  const claims = yield* authorize(deps, actor, "read", view.target, operationId);
  if (record === null) {
    const { document } = yield* resolveTarget(deps, claims, {
      documentId: view.target.documentId,
      scope: view.target.scope,
    });
    const draft = yield* draftForView(deps, view);
    record = yield* reserveOperation(deps, claims, intent, document, draft);
  }
  if (terminalReceipt(record.receipt.phase)) return record.receipt;
  if (record.receipt.phase === "execution-unknown" || record.receipt.phase === "needs-attention")
    return record.receipt;
  yield* verifyOperation(deps, record, view.target, "final-commit");
  const jobId = yield* boundedMetadataDigest(
    ["office-output-job", 1, view.owner, operationId],
    deps.policy.limits.metadataBytes,
  );
  if (record.jobId !== null && record.jobId !== jobId)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  const existing = yield* existingReadJob(deps, view, spec, jobId, operationId);
  if (
    existing === null &&
    (record.receipt.phase !== "reserved" ||
      record.artifacts.input !== null ||
      record.jobId !== null)
  )
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", operationId));
  const prepared =
    existing ?? (yield* prepareReadJob(deps, runtime, actor, view, spec, jobId, operationId));
  const job = prepared.job;
  if (job.kind === "inspect")
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  const current = yield* operationRecord(deps, record.owner, operationId);
  if (current === null) return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", operationId));
  record = current;
  if (terminalReceipt(record.receipt.phase)) return record.receipt;
  if (
    record.artifacts.input !== null &&
    artifactKey(record.artifacts.input) !== artifactKey(job.input)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operationId));
  if (record.receipt.phase === "reserved")
    record = yield* advanceOperation(deps, record, "input-pinned", {
      jobId,
      artifacts: { ...record.artifacts, input: job.input },
    });
  if (record.jobId !== jobId || record.artifacts.input === null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", operationId));
  if (record.receipt.phase === "input-pinned")
    record = yield* advanceOperation(deps, record, "queued");
  return yield* publishReadOutput(deps, actor, view, record, job);
});
