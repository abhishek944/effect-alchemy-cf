import { Effect } from "effect";
import { Execute, decodeWire, safeFailure } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { authorize } from "./claims.ts";
import { operationCaller } from "./operation-caller.ts";
import { advanceOperation, reserveOperation, terminalReceipt } from "./operations.ts";
import { resolveLiveState } from "./target.ts";
import { executionJob } from "./execute-input.ts";
import { executionStatus, stageExecutionProposal } from "./execute-output.ts";
import { storeJobState } from "./job-state.ts";
import { commitExecution } from "./execute-commit.ts";
import { observeExecution } from "./execute-observe.ts";
import { officeFailure } from "./failure.ts";

export const progressExecution = Effect.fn("Office.progressExecution")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  record: OperationRecord,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (terminalReceipt(record.receipt.phase)) return record.receipt;
  if (
    ["admitted", "dispatching", "submission-unknown", "publishing", "needs-attention"].includes(
      record.receipt.phase,
    )
  )
    return yield* observeExecution(deps, record);
  if (!submit) {
    if (record.jobId === null) return record.receipt;
    const existingJob = yield* deps.metadata.job(record.owner, record.jobId);
    if (existingJob === null) return record.receipt;
  }
  const prepared = yield* executionJob(deps, runtime, record, phase);
  const state = yield* executionStatus(deps, prepared.record, prepared.job, submit, phase);
  const current = yield* storeJobState(deps, prepared.record, prepared.job, state);
  if (state.state !== "succeeded") return current.receipt;
  const staged = yield* stageExecutionProposal(deps, current, prepared.job, state);
  if (!submit) return staged.record.receipt;
  return yield* commitExecution(deps, runtime, staged.record, staged.proposal, phase);
});
export const makeOfficeExecution = (deps: OfficeDependencies, runtime: OfficeNativeRuntime) => ({
  execute: Effect.fn("Office.execute")(function* (actor: Actor, value: Execute) {
    const input = yield* decodeWire(Execute)(value).pipe(
      Effect.mapError(() => officeFailure("INVALID_INPUT")),
    );
    const caller = yield* operationCaller(deps, actor, input.operationId, {
      kind: "execute",
      input,
    });
    const claims = caller.claims;
    let record = caller.record;
    if (record === null) {
      if (claims === null) return yield* Effect.fail(officeFailure("FORBIDDEN"));
      const resolved = yield* resolveLiveState(deps, actor, {
        documentId: input.target.documentId,
        scope: {
          kind: "draft",
          draftId: input.target.draftId,
          generation: input.target.generation,
        },
      });
      yield* authorize(deps, actor, "edit", resolved.target, input.operationId);
      const draft = yield* deps.metadata.draft(claims.owner, input.target.draftId);
      if (draft === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
      record = yield* reserveOperation(
        deps,
        claims,
        { kind: "execute", input },
        resolved.document,
        draft,
      );
      if (!resolved.state.editable || resolved.state.revision !== input.target.expectedRevision) {
        const failed = yield* advanceOperation(
          deps,
          record,
          "conflict",
          {},
          {
            error: safeFailure(
              resolved.state.editable ? "STALE_BASIS" : "NOT_EDITABLE",
              input.operationId,
            ),
          },
        );
        return failed.receipt;
      }
    }
    if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    return yield* progressExecution(
      deps,
      runtime,
      record,
      true,
      actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
    );
  }),
});
