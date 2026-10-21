import { Effect } from "effect";
import { ImportInto, decodeWire, safeFailure } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { operationCaller, operationTarget } from "./operation-caller.ts";
import { authorize, verifyOperation } from "./claims.ts";
import { resolveLiveState } from "./target.ts";
import { advanceOperation, reserveOperation, terminalReceipt } from "./operations.ts";
import { importJob, importStatus } from "./import-input.ts";
import { storeJobState } from "./job-state.ts";
import { stageImportIntoProposal } from "./import-into-proposal.ts";
import { commitExecution } from "./execute-commit.ts";
import { observeExecution } from "./execute-observe.ts";
import { artifactKey } from "../jobs/artifacts.ts";
import { operationRecord } from "./operation-read.ts";
import { nativeWrites } from "./native-complete.ts";
import { officeFailure } from "./failure.ts";

export const progressImportInto = Effect.fn("Office.progressImportInto")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  record: OperationRecord,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (record.intent.kind !== "import-into")
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  if (terminalReceipt(record.receipt.phase)) return record.receipt;
  if (
    ["admitted", "dispatching", "submission-unknown", "publishing", "needs-attention"].includes(
      record.receipt.phase,
    )
  )
    return yield* observeExecution(deps, record);
  if (!submit) {
    if (record.jobId === null) return record.receipt;
    const saved = yield* deps.metadata.job(record.owner, record.jobId);
    if (saved === null) return record.receipt;
    if (
      saved.job.kind !== "import" ||
      saved.job.binding.operationId !== record.receipt.operationId ||
      artifactKey(saved.job.input) !== artifactKey(record.intent.input.source)
    )
      return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT"));
    const state = yield* deps.jobs.status(record.owner, record.jobId);
    return (yield* storeJobState(deps, record, saved.job, state)).receipt;
  }
  if (record.policyVersion !== deps.policy.version)
    return yield* Effect.fail(officeFailure("EXECUTOR_UNCONFIGURED"));
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), phase);
  const prepared = yield* importJob(deps, record, phase);
  const state = yield* importStatus(deps, prepared.record, prepared.job, true, phase);
  const current = yield* storeJobState(deps, prepared.record, prepared.job, state);
  if (state.state !== "succeeded" || terminalReceipt(current.receipt.phase)) return current.receipt;
  const staged = yield* stageImportIntoProposal(
    deps,
    runtime,
    current,
    prepared.job,
    state,
    phase,
  ).pipe(
    Effect.map((value) => ({ proposal: value, receipt: null })),
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (
          !["FORBIDDEN", "INVALID_INPUT", "LIMIT_EXCEEDED", "NATIVE_CONFLICT"].includes(error.code)
        )
          return yield* Effect.fail(error);
        const latest = yield* operationRecord(deps, record.owner, record.receipt.operationId);
        if (
          latest === null ||
          latest.intentDigest !== record.intentDigest ||
          latest.lineageDigest !== record.lineageDigest
        )
          return yield* Effect.fail(error);
        yield* verifyOperation(deps, latest, yield* operationTarget(deps, latest), phase);
        if (terminalReceipt(latest.receipt.phase))
          return { proposal: null, receipt: latest.receipt };
        if (
          !["reserved", "input-pinned", "queued", "running"].includes(latest.receipt.phase) ||
          (yield* nativeWrites(deps, latest)).length !== 0
        )
          return yield* Effect.fail(error);
        const failed = yield* advanceOperation(
          deps,
          latest,
          "failed-before-submit",
          {},
          {
            error: safeFailure(error.code, latest.receipt.operationId),
          },
        );
        return { proposal: null, receipt: failed.receipt };
      }).pipe(Effect.catch(() => Effect.fail(error))),
    ),
  );
  if (staged.proposal === null) return staged.receipt;
  return yield* commitExecution(
    deps,
    runtime,
    staged.proposal.record,
    staged.proposal.proposal,
    phase,
  );
});

export const makeOfficeImportInto = (deps: OfficeDependencies, runtime: OfficeNativeRuntime) => ({
  importInto: Effect.fn("Office.importInto")(function* (actor: Actor, value: ImportInto) {
    const input = yield* decodeWire(ImportInto)(value).pipe(
      Effect.mapError(() => officeFailure("INVALID_INPUT")),
    );
    const caller = yield* operationCaller(deps, actor, input.operationId, {
      kind: "import-into",
      input,
    });
    let record = caller.record;
    if (record === null) {
      if (caller.claims === null) return yield* Effect.fail(officeFailure("FORBIDDEN"));
      const resolved = yield* resolveLiveState(deps, actor, {
        documentId: input.target.documentId,
        scope: {
          kind: "draft",
          draftId: input.target.draftId,
          generation: input.target.generation,
        },
      });
      yield* authorize(deps, actor, "edit", resolved.target, input.operationId);
      if (resolved.document.document.kind !== "sheet")
        return yield* Effect.fail(officeFailure("INVALID_INPUT"));
      const draft = yield* deps.metadata.draft(caller.claims.owner, input.target.draftId);
      if (draft === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
      record = yield* reserveOperation(
        deps,
        caller.claims,
        { kind: "import-into", input },
        resolved.document,
        draft,
      );
      if (!resolved.state.editable || resolved.state.revision !== input.target.expectedRevision)
        return (yield* advanceOperation(
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
        )).receipt;
    }
    return yield* progressImportInto(
      deps,
      runtime,
      record,
      true,
      actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
    );
  }),
});
