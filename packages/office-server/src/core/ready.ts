import { Effect } from "effect";
import { DraftTransition, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OfficeService, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { operationCaller } from "./operation-caller.ts";
import { operationRecord } from "./operation-read.ts";
import { authorize } from "./claims.ts";
import { resolveLiveState } from "./target.ts";
import { reserveOperation, terminalReceipt } from "./operations.ts";
import { nativeWrites, retainNativeUncertainty } from "./native-complete.ts";
import { prepareReady } from "./ready-write.ts";
import { officeFailure } from "./failure.ts";

export const progressReady = Effect.fn("Office.progressReady")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  original: OperationRecord,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (terminalReceipt(original.receipt.phase)) return original.receipt;
  return yield* Effect.gen(function* () {
    if (submit && actor.capability === "recovery" && phase !== "recovery-dispatch")
      return yield* Effect.fail(officeFailure("FORBIDDEN", original.receipt.operationId));
    const prepared = yield* prepareReady(deps, runtime, original, submit, phase);
    return prepared.receipt;
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const current = yield* operationRecord(deps, original.owner, original.receipt.operationId);
        if (current === null) return yield* Effect.fail(error);
        if (terminalReceipt(current.receipt.phase)) return current.receipt;
        if ((yield* nativeWrites(deps, current)).length > 0)
          return yield* retainNativeUncertainty(deps, current);
        return yield* Effect.fail(error);
      }),
    ),
  );
});
export function makeOfficeReady(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "ready"> {
  return {
    ready: Effect.fn("Office.ready")(function* (actor: Actor, value: DraftTransition) {
      const input = yield* decodeWire(DraftTransition)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
      );
      const context = yield* operationCaller(deps, actor, input.operationId, {
        kind: "ready",
        input,
      });
      let record = context.record;
      if (record === null) {
        if (context.claims === null || actor.capability === "recovery")
          return yield* Effect.fail(officeFailure("FORBIDDEN"));
        const draft = yield* deps.metadata.draft(context.claims.owner, input.draftId);
        if (draft === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
        const live = yield* resolveLiveState(deps, actor, {
          documentId: draft.documentId,
          scope: { kind: "draft", draftId: draft.id, generation: input.generation },
        });
        yield* authorize(deps, actor, "ready", live.target, input.operationId);
        if (!live.state.editable)
          return yield* Effect.fail(officeFailure("NOT_EDITABLE", input.operationId));
        record = yield* reserveOperation(
          deps,
          context.claims,
          { kind: "ready", input },
          live.document,
          draft,
        );
      }
      return yield* progressReady(
        deps,
        runtime,
        actor,
        record,
        true,
        actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
      );
    }),
  };
}
