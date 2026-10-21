import { Effect } from "effect";
import { CreateDocument, CreateDraft, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OfficeService, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { operationCaller } from "./operation-caller.ts";
import { authorize } from "./claims.ts";
import { reserveCreation, reserveBranch } from "./create-reserve.ts";
import { commitCreation, type CreationSeed } from "./create-write.ts";
import { creationEvidence } from "./create-proof.ts";
import { createBlankNative } from "./blank.ts";
import { importJob, importStatus } from "./import-input.ts";
import { stageImportedSeed } from "./import-output.ts";
import { storeJobState } from "./job-state.ts";
import { terminalReceipt } from "./operations.ts";
import { resolveLiveState } from "./target.ts";
import { nativeCall, officeFailure } from "./failure.ts";

export const progressCreation = Effect.fn("Office.progressCreation")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (terminalReceipt(original.receipt.phase)) return original.receipt;
  if (original.intent.kind !== "create" && original.intent.kind !== "create-draft")
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const proof = yield* creationEvidence(deps, original);
  if (proof.writes.length > 0 && (!proof.known || proof.complete))
    return yield* commitCreation(deps, runtime, original, null, phase);
  let record = original;
  let seed: CreationSeed;
  if (original.intent.kind === "create-draft") {
    if (!submit) return record.receipt;
    seed = { kind: "branch" };
  } else {
    const { source, title } = original.intent.input;
    if (source.kind === "blank") {
      if (!submit) return record.receipt;
      seed = {
        kind: "data",
        input: yield* nativeCall(() =>
          createBlankNative(source.documentKind, original.unitId, title),
        ),
      };
    } else {
      if (
        !submit &&
        (record.jobId === null || (yield* deps.metadata.job(record.owner, record.jobId)) === null)
      )
        return record.receipt;
      const prepared = yield* importJob(deps, record, phase);
      const state = yield* importStatus(deps, prepared.record, prepared.job, submit, phase);
      record = yield* storeJobState(deps, prepared.record, prepared.job, state);
      if (state.state !== "succeeded") return record.receipt;
      const staged = yield* stageImportedSeed(deps, record, prepared.job, state);
      record = staged.record;
      if (!submit) return record.receipt;
      seed = { kind: "snapshot", native: staged.native };
    }
  }
  return yield* commitCreation(deps, runtime, record, seed, phase);
});
export function makeOfficeCreation(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "create" | "createDraft"> {
  return {
    create: Effect.fn("Office.create")(function* (actor: Actor, value: CreateDocument) {
      const input = yield* decodeWire(CreateDocument)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
      );
      const context = yield* operationCaller(deps, actor, input.operationId, {
        kind: "create",
        input,
      });
      let record = context.record;
      if (record === null) {
        if (context.claims === null || actor.capability === "recovery")
          return yield* Effect.fail(officeFailure("FORBIDDEN"));
        yield* authorize(deps, actor, "create", null, input.operationId);
        record = yield* reserveCreation(deps, context.claims, input);
      }
      return yield* progressCreation(
        deps,
        runtime,
        record,
        true,
        actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
      );
    }),
    createDraft: Effect.fn("Office.createDraft")(function* (actor: Actor, value: CreateDraft) {
      const input = yield* decodeWire(CreateDraft)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
      );
      const context = yield* operationCaller(deps, actor, input.operationId, {
        kind: "create-draft",
        input,
      });
      let record = context.record;
      if (record === null) {
        if (context.claims === null || actor.capability === "recovery")
          return yield* Effect.fail(officeFailure("FORBIDDEN"));
        const main = yield* resolveLiveState(deps, actor, {
          documentId: input.documentId,
          scope: { kind: "main" },
        });
        yield* authorize(deps, actor, "create-draft", main.target, input.operationId);
        record = yield* reserveBranch(deps, context.claims, input, main.document);
      }
      return yield* progressCreation(
        deps,
        runtime,
        record,
        true,
        actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
      );
    }),
  };
}
