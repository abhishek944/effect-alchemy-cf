import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type { OfficeDependencies, OperationRecord, WritePermit } from "../ports/index.ts";
import type { NativeServices } from "./native-services.ts";
import { ReadyCapture } from "./review-bundle.ts";
import { loadNativeArtifact, stageNativeArtifact } from "./bytes.ts";
import { materializeRevision } from "./native-materialize.ts";
import { operationRecord } from "./operation-read.ts";
import { advanceOperation } from "./operations.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { evaluateReady } from "./ready-evaluate.ts";

export const readReadyCapture = Effect.fn("Office.readReadyCapture")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  field: "input" | "proposal",
) {
  const ref = record.artifacts[field];
  if (ref === null || record.intent.kind !== "ready")
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const raw = yield* loadNativeArtifact(deps, record.owner, ref, "job-input");
  const capture = yield* decodeWire(ReadyCapture)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    capture.operationId !== record.receipt.operationId ||
    capture.documentId !== record.documentId ||
    capture.unitId !== record.unitId ||
    capture.worktreeId !== record.worktreeId ||
    capture.draftId !== record.intent.input.draftId ||
    capture.generation !== record.intent.input.generation
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  return capture;
});
/** Called inside the existing Ready SDK invocation: one actual adapter pair, never another serial turn. */
export const captureReady = Effect.fn("Office.captureReady")(function* (
  deps: OfficeDependencies,
  services: NativeServices,
  original: OperationRecord,
  permit: WritePermit,
) {
  if (
    original.intent.kind !== "ready" ||
    original.worktreeId === null ||
    permit.target.scope.kind !== "draft"
  )
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  let record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (record.artifacts.proposal !== null) return yield* readReadyCapture(deps, record, "proposal");
  const context = { userID: original.owner.ownerId };
  const worktreeID = original.worktreeId;
  const aggregate = yield* nativeCall(() => services.drafts.getWorktree({ worktreeID }, context));
  const unit = aggregate.worktree.units.find((value) => value.unitID === original.unitId);
  if (aggregate.worktree.status !== "ready" || unit?.readyDraftHeadRevision === undefined)
    return yield* Effect.fail(officeFailure("NOT_EDITABLE"));
  const document = yield* deps.metadata.document(record.owner, record.documentId);
  if (document === null || document.unitId !== record.unitId)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const kind = document.document.kind;
  const mainRevision = document.location === "main" ? document.document.revision : null;
  if (
    unit.source === "trunk" &&
    (unit.baselineTrunkRevision === undefined || mainRevision === null)
  )
    return yield* Effect.fail(officeFailure("HISTORY_INCOMPLETE"));
  let capture: ReadyCapture;
  if (record.artifacts.input !== null) capture = yield* readReadyCapture(deps, record, "input");
  else {
    const materialize = (worktree: string | null, revision: number) =>
      nativeCall(() =>
        materializeRevision(
          services,
          original.owner.ownerId,
          original.unitId,
          worktree,
          kind,
          revision,
          deps.policy.limits,
        ),
      );
    const draft = yield* materialize(worktreeID, unit.readyDraftHeadRevision);
    const baselineRevision = unit.baselineTrunkRevision ?? null;
    const baseline = baselineRevision === null ? null : yield* materialize(null, baselineRevision);
    const main = mainRevision === null ? null : yield* materialize(null, mainRevision);
    capture = {
      purpose: "office-ready-capture",
      version: 1,
      operationId: record.receipt.operationId,
      documentId: record.documentId,
      draftId: original.intent.input.draftId,
      unitId: record.unitId,
      worktreeId: worktreeID,
      generation: original.intent.input.generation,
      kind,
      source: unit.source,
      removed: unit.removed === true,
      baselineRevision,
      readyRevision: unit.readyDraftHeadRevision,
      mainRevision,
      main,
      baseline,
      draft,
      result: null,
      state: "incomplete",
      fidelity: "snapshot",
      leftChangesets: [],
      rightChangesets: [],
    };
    const ref = yield* stageNativeArtifact(
      deps,
      record.owner,
      "native-input",
      "job-input",
      capture,
    );
    record = yield* advanceOperation(deps, record, record.receipt.phase, {
      artifacts: { ...record.artifacts, input: ref },
    });
  }
  if (
    capture.mainRevision !== mainRevision ||
    capture.readyRevision !== unit.readyDraftHeadRevision
  )
    return yield* Effect.fail(officeFailure("STALE_REVIEW", record.receipt.operationId));
  const evaluated = yield* nativeCall(() =>
    evaluateReady(deps, services, record.owner.ownerId, capture),
  );
  const ref = yield* stageNativeArtifact(
    deps,
    record.owner,
    "native-preview",
    "job-input",
    evaluated,
  );
  const current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (current.artifacts.proposal === null)
    yield* advanceOperation(deps, current, current.receipt.phase, {
      artifacts: { ...current.artifacts, proposal: ref },
    });
  return yield* readReadyCapture(
    deps,
    {
      ...current,
      artifacts: { ...current.artifacts, proposal: current.artifacts.proposal ?? ref },
    },
    "proposal",
  );
});
