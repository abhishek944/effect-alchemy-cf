import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { decodeWireSync } from "@highchat/office-contract";
import { decodeNativeFrame } from "@highchat/office-contract/native-wire";
import type { IsolatedJob, JobState, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { importIntoInput } from "./import-into-input.ts";
import { readArtifact, stageNativeArtifact } from "./bytes.ts";
import { ImportedOutputSchema } from "../jobs/output.ts";
import { requireBinding, requireSnapshot } from "../jobs/frames.ts";
import { prepareSheetInsertions } from "../jobs/sheet-insert.ts";
import { replayMutationCandidate } from "../jobs/replay.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { operationRecord } from "./operation-read.ts";
import { operationTarget } from "./operation-caller.ts";
import { verifyOperation } from "./claims.ts";
import { advanceOperation } from "./operations.ts";
import { readProposal } from "./proposal.ts";

export const stageImportIntoProposal = Effect.fn("Office.stageImportIntoProposal")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  job: Extract<IsolatedJob, { kind: "import" }>,
  state: Extract<JobState, { state: "succeeded" }>,
  phase: "final-commit" | "recovery-dispatch",
) {
  if (
    original.intent.kind !== "import-into" ||
    state.jobId !== job.binding.jobId ||
    state.inputDigest !== job.binding.inputDigest
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT"));
  const action = original.intent.input;
  yield* verifyOperation(deps, original, yield* operationTarget(deps, original), phase);
  const wire = yield* readArtifact(deps, original.owner, state.output);
  const source = yield* Effect.try({
    try: () => {
      const output = decodeWireSync(ImportedOutputSchema)(
        decodeNativeFrame(wire, "job-output").payload,
      );
      requireBinding(output.binding, job.binding);
      requireSnapshot(output.native, job.binding);
      if (output.native.snapshot.rev !== 1) throw officeFailure("INVALID_INPUT");
      return { binding: output.binding, native: output.native };
    },
    catch: () => officeFailure("CONTENT_REQUIRED", action.operationId),
  });
  // Pre-materialization admission of this source+target pair (with target history) belongs to
  // importIntoInput; prepareSheetInsertions re-admits the same pair immediately before SDK load,
  // which is the boundary that also covers an already-pinned input artifact.
  const pinned = yield* importIntoInput(deps, runtime, original, job, source, phase);
  const record = pinned.record;
  if (record.artifacts.proposal !== null)
    return {
      record,
      proposal: yield* readProposal(
        deps,
        record.owner,
        record.artifacts.proposal,
        pinned.frame.binding,
      ),
    };
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), phase);
  const mutations = yield* nativeCall(() => prepareSheetInsertions(source, pinned.frame, action));
  const proposal = yield* nativeCall(() =>
    replayMutationCandidate(
      pinned.frame,
      mutations,
      {
        userId: record.owner.ownerId,
        memberId: randomUUID(),
        sid: randomUUID(),
        reqId: 1,
      },
      true,
    ),
  );
  const ref = yield* stageNativeArtifact(
    deps,
    record.owner,
    "native-proposal",
    "proposal",
    proposal,
  );
  const current = yield* operationRecord(deps, record.owner, action.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* verifyOperation(deps, current, yield* operationTarget(deps, current), phase);
  if (current.artifacts.proposal !== null)
    return {
      record: current,
      proposal: yield* readProposal(
        deps,
        current.owner,
        current.artifacts.proposal,
        pinned.frame.binding,
      ),
    };
  const updated = yield* advanceOperation(deps, current, "proposal-staged", {
    artifacts: { ...current.artifacts, proposal: ref },
  });
  return { record: updated, proposal };
});
