import { Effect, Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import type {
  IsolatedJob,
  NativeInputFrame,
  OfficeDependencies,
  OperationRecord,
} from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { materializeNativeSnapshot } from "./input.ts";
import { stageNativeArtifact, readArtifact } from "./bytes.ts";
import { verifyOperation } from "./claims.ts";
import { operationTarget } from "./operation-caller.ts";
import { operationRecord } from "./operation-read.ts";
import { advanceOperation } from "./operations.ts";
import { officeFailure } from "./failure.ts";
import { decodeJobInput, snapshotDigest, JOB_NATIVE_LIMITS } from "../jobs/frames.ts";
import { ProposalBindingSchema } from "../jobs/schemas.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { preflightSheetLoads } from "../jobs/sheet-load-preflight.ts";

const Input = Schema.Struct({ binding: ProposalBindingSchema, native: SnapshotWithBlocksSchema });
export const importIntoInput = Effect.fn("Office.importIntoInput")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  job: Extract<IsolatedJob, { kind: "import" }>,
  source: NativeInputFrame,
  phase: "final-commit" | "recovery-dispatch",
) {
  if (original.intent.kind !== "import-into" || original.worktreeId === null)
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const input = original.intent.input;
  const target = yield* operationTarget(deps, original);
  const base = {
    ...job.binding,
    unitId: original.unitId,
    generation: input.target.generation,
    baseRevision: input.target.expectedRevision,
  };
  let record = original;
  if (record.artifacts.input === null) {
    yield* verifyOperation(deps, original, target, phase);
    const epochs = yield* deps.authority.current(original.owner, original.documentId);
    const native = yield* materializeNativeSnapshot(
      deps,
      runtime,
      { kind: "read", target, ...epochs },
      original.worktreeId,
      "sheet",
      input.target.expectedRevision,
      (loaded) =>
        preflightSheetLoads(
          [source.native, { snapshot: loaded.snapshot, sheetBlocks: [...loaded.sheetBlocks] }],
          loaded.changesets,
        ),
    );
    const digest = yield* Effect.try({
      try: () => snapshotDigest(native),
      catch: () => officeFailure("LIMIT_EXCEEDED"),
    });
    const ref = yield* stageNativeArtifact(
      deps,
      original.owner,
      "native-input",
      "job-input",
      { binding: { ...base, inputDigest: digest }, native },
      Math.min(deps.policy.limits.nativeBytes, JOB_NATIVE_LIMITS.maxBytes),
    );
    const current = yield* operationRecord(deps, original.owner, input.operationId);
    if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    yield* verifyOperation(deps, current, target, phase);
    record =
      current.artifacts.input !== null
        ? current
        : yield* advanceOperation(deps, current, current.receipt.phase, {
            artifacts: { ...current.artifacts, input: ref },
          });
  }
  const ref = record.artifacts.input;
  if (ref === null || ref.kind !== "native-input")
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const bytes = yield* readArtifact(
    deps,
    record.owner,
    ref,
    Math.min(deps.policy.limits.nativeBytes, JOB_NATIVE_LIMITS.maxBytes),
  );
  const frame = yield* Effect.try({
    try: () => {
      const raw = decodeWireSync(Input)(
        decodeNativeFrame(bytes, "job-input", JOB_NATIVE_LIMITS).payload,
      );
      const binding = { ...base, inputDigest: snapshotDigest(raw.native) };
      const checked = decodeJobInput(bytes, binding);
      return { binding, native: checked.native };
    },
    catch: () => officeFailure("CONTENT_REQUIRED", input.operationId),
  });
  return { record, frame };
});
