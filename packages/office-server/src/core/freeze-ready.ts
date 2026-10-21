import { Clock, Effect, Schema } from "effect";
import { decodeWire } from "@starter/office-contract";
import type {
  FrozenReview,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import { stageReadyRoleView } from "./artifact-view.ts";
import { reviewKey } from "./reads.ts";
import { ReadyCapture, ReviewBundle, reviewFingerprint } from "./review-bundle.ts";
import { compareReview } from "./review-comparison.ts";
import { snapshotDigest } from "../jobs/frames.ts";
import { stageNativeArtifact } from "./bytes.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { verifyOperation } from "./claims.ts";
import { operationRecord } from "./operation-read.ts";
import { confirmNativeWrites } from "./native-complete.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
const sameReview = Schema.toEquivalence(Schema.Json);

/** Called only inside the original Ready SDK callback, before its live native permit is released. */
export const publishReadyReview = Effect.fn("Office.publishReadyReview")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  permit: WritePermit,
  input: ReadyCapture,
  phase: "final-commit" | "recovery-dispatch",
) {
  const record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (record === null || record.intent.kind !== "ready" || record.artifacts.proposal === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
  yield* verifyOperation(deps, record, permit.target, phase);
  if (record.receipt.reviewId !== null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  if (record.policyVersion !== deps.policy.version)
    return yield* Effect.fail(officeFailure("EXECUTOR_UNCONFIGURED", permit.operationId));
  const capture = yield* decodeWire(ReadyCapture)(input).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  if (
    permit.operationId !== record.receipt.operationId ||
    capture.operationId !== record.receipt.operationId ||
    capture.documentId !== record.documentId ||
    capture.unitId !== record.unitId ||
    capture.worktreeId !== record.worktreeId ||
    capture.draftId !== record.intent.input.draftId ||
    capture.generation !== record.intent.input.generation ||
    capture.readyRevision !== permit.expectedHead
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
  const document = yield* deps.metadata.document(record.owner, record.documentId);
  if (
    document === null ||
    document.unitId !== record.unitId ||
    document.document.kind !== capture.kind
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
  const id = reviewKey(
    record.owner,
    record.documentId,
    capture.draftId,
    capture.generation,
    capture.readyRevision,
  );
  const makeView = (role: "main" | "baseline" | "draft" | "result") => {
    const native = capture[role];
    if (native === null) return Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
    return stageReadyRoleView(
      deps,
      record,
      permit,
      {
        owner: record.owner,
        documentId: record.documentId,
        unitId: record.unitId,
        scope:
          role === "main" || role === "baseline"
            ? { kind: "main" }
            : { kind: "draft", draftId: capture.draftId, generation: capture.generation },
      },
      capture.kind,
      native,
      phase,
    );
  };
  const main = capture.main === null ? null : yield* makeView("main");
  const baseline = capture.baseline === null ? null : yield* makeView("baseline");
  const draft = yield* makeView("draft");
  let result = null;
  const nativeResult = capture.result;
  if (nativeResult !== null) {
    const equal = yield* Effect.try({
      try: () => snapshotDigest(nativeResult) === snapshotDigest(capture.draft),
      catch: () => officeFailure("CONTENT_REQUIRED", permit.operationId),
    });
    result = equal ? draft : yield* makeView("result");
  }
  const compared = yield* nativeCall(() =>
    compareReview(capture, id, main?.view.id ?? draft.view.id, result?.view.id ?? draft.view.id),
  );
  const bundle = yield* decodeWire(ReviewBundle)({
    purpose: "office-review-bundle",
    version: 1,
    capture,
    ...compared,
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)));
  const preview = yield* stageNativeArtifact(
    deps,
    record.owner,
    "native-preview",
    "job-output",
    bundle,
  );
  const roles = [main, baseline, draft, result].filter((value) => value !== null);
  const now = yield* Clock.currentTimeMillis;
  const value: Omit<FrozenReview, "fingerprint"> = {
    owner: record.owner,
    id,
    documentId: record.documentId,
    unitId: record.unitId,
    worktreeId: capture.worktreeId,
    generation: capture.generation,
    baselineRevision: capture.baselineRevision,
    draftRevision: capture.readyRevision,
    readyRevision: capture.readyRevision,
    mainRevision: capture.mainRevision,
    source: capture.source,
    removed: capture.removed,
    destination: {
      documentId: record.documentId,
      unitId: record.unitId,
      title: document.document.title,
    },
    main: main?.view ?? null,
    baseline: baseline?.view ?? null,
    draft: draft.view,
    result: result?.view ?? null,
    preview,
    sdkVersion: "1.0.3",
    policyVersion: record.policyVersion,
    state:
      capture.state === "conflict"
        ? "conflict"
        : capture.state === "complete" && bundle.readiness === "ready"
          ? "complete"
          : "incomplete",
    expiresAt: Math.min(now + 300_000, ...roles.map((role) => role.view.expiresAt)),
  };
  const review: FrozenReview = { ...value, fingerprint: reviewFingerprint(value) };
  const writes = yield* confirmNativeWrites(deps, record, permit);
  const marks = writes.filter(
    (write) =>
      write.kind === "lifecycle" &&
      write.worktreeId === record.worktreeId &&
      write.generation === capture.generation &&
      write.baseRevision === capture.readyRevision &&
      write.receiptKey.kind === "transition" &&
      write.receiptKey.target === "ready" &&
      write.receiptKey.worktreeId === capture.worktreeId &&
      write.receiptKey.generation === capture.generation,
  );
  if (marks.length !== 1)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  yield* verifyOperation(deps, record, permit.target, phase);
  const published = yield* deps.metadata.putReview(review);
  const actual = yield* decodeWire(Schema.Json)(published).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  const expected = yield* decodeWire(Schema.Json)(review).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  if (!sameReview(actual, expected))
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
  const current = yield* operationRecord(deps, record.owner, permit.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
  yield* verifyOperation(deps, current, permit.target, phase);
  if (terminalReceipt(current.receipt.phase)) {
    if (current.receipt.phase === "confirmed" && current.receipt.reviewId === review.id)
      return current;
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  }
  if (current.receipt.reviewId !== null && current.receipt.reviewId !== review.id)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
  return yield* advanceOperation(
    deps,
    current,
    "confirmed",
    {},
    {
      reviewId: published.id,
      acceptedRevision: null,
      error: null,
    },
  );
});
