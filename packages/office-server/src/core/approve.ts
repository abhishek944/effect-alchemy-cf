import { Clock, Effect } from "effect";
import { Approve, decodeWire } from "@starter/office-contract";
import type {
  ApprovalRecord,
  HumanActor,
  OfficeDependencies,
  OfficeService,
} from "../ports/index.ts";
import { operationCaller } from "./operation-caller.ts";
import { operationRecord } from "./operation-read.ts";
import { authorize, verifyOperation } from "./claims.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { assertReviewCurrent } from "./review-state.ts";
import { reserveOperation, advanceOperation, terminalReceipt } from "./operations.ts";
import { officeFailure } from "./failure.ts";

export function makeOfficeApproval(deps: OfficeDependencies): Pick<OfficeService, "approve"> {
  return {
    approve: Effect.fn("Office.approve")(function* (actor: HumanActor, value: Approve) {
      if (actor.capability !== "human") return yield* Effect.fail(officeFailure("FORBIDDEN"));
      const input = yield* decodeWire(Approve)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
      );
      const context = yield* operationCaller(deps, actor, input.operationId, {
        kind: "approve",
        input,
      });
      let record = context.record;
      if (record !== null && terminalReceipt(record.receipt.phase)) return record.receipt;
      const review = yield* deps.metadata.review(actor.owner, input.reviewId);
      if (review === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
      const bundle = yield* readReviewBundle(deps, review);
      const target = {
        owner: review.owner,
        documentId: review.documentId,
        unitId: review.unitId,
        scope: {
          kind: "draft" as const,
          draftId: bundle.capture.draftId,
          generation: review.generation,
        },
      };
      yield* authorize(deps, actor, "approve", target, input.operationId);
      if (record === null) {
        if (context.claims === null) return yield* Effect.fail(officeFailure("FORBIDDEN"));
        const current = yield* assertReviewCurrent(deps, review);
        record = yield* reserveOperation(
          deps,
          context.claims,
          { kind: "approve", input },
          current.document,
          current.draft,
        );
      }
      if (
        record.actor.capability !== "human" ||
        record.documentId !== review.documentId ||
        record.unitId !== review.unitId
      )
        return yield* Effect.fail(officeFailure("FORBIDDEN"));
      const expected: ApprovalRecord = {
        owner: record.owner,
        operationId: input.operationId,
        reviewId: review.id,
        fingerprint: review.fingerprint,
        humanPrincipalId: record.actor.principalId,
        sessionEpoch: record.actor.sessionEpoch,
        expiresAt: Math.min(record.actor.expiresAt, review.expiresAt, record.createdAt + 300_000),
        consumedBy: null,
      };
      const matches = (approval: ApprovalRecord) =>
        approval.operationId === expected.operationId &&
        approval.reviewId === expected.reviewId &&
        approval.fingerprint === expected.fingerprint &&
        approval.humanPrincipalId === expected.humanPrincipalId &&
        approval.sessionEpoch === expected.sessionEpoch &&
        approval.expiresAt === expected.expiresAt;
      const previous = yield* deps.metadata.approval(record.owner, input.operationId);
      if (previous !== null) {
        if (!matches(previous))
          return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
        yield* verifyOperation(deps, record, target, "recovery-observe");
      } else {
        if ((yield* Clock.currentTimeMillis) >= expected.expiresAt)
          return yield* Effect.fail(officeFailure("STALE_REVIEW", input.operationId));
        yield* assertReviewCurrent(deps, review);
        yield* verifyOperation(deps, record, target, "final-commit");
        const owner = record.owner;
        const accepted = yield* deps.metadata
          .approve(expected)
          .pipe(
            Effect.catch((error) =>
              deps.metadata
                .approval(owner, input.operationId)
                .pipe(
                  Effect.flatMap((stored) =>
                    stored !== null && matches(stored)
                      ? Effect.succeed(stored)
                      : Effect.fail(error),
                  ),
                ),
            ),
          );
        if (!matches(accepted))
          return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
      }
      const current = yield* operationRecord(deps, record.owner, input.operationId);
      if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
      if (terminalReceipt(current.receipt.phase)) return current.receipt;
      const confirmed = yield* advanceOperation(
        deps,
        current,
        "confirmed",
        {},
        { reviewId: review.id, error: null, acceptedRevision: null },
      );
      return confirmed.receipt;
    }),
  };
}
