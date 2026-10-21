import { Effect } from "effect";
import { DraftTransition, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OfficeService } from "../../ports/index.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { authorize } from "../claims.ts";
import { operationCaller } from "../operation-caller.ts";
import { StoredDraft } from "../record-schemas.ts";
import { resolveTarget } from "../target.ts";
import { reserveOperation } from "../operations.ts";
import { officeFailure } from "../failure.ts";
import { progressTransition, transitionFailure } from "./progress.ts";

export function makeOfficeTransitions(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "reopen" | "discard"> {
  const transition = Effect.fn("Office.transition")(function* (
    kind: "reopen" | "discard",
    actor: Actor,
    value: DraftTransition,
  ) {
    const input = yield* decodeWire(DraftTransition)(value).pipe(
      Effect.mapError(() => officeFailure("INVALID_INPUT")),
    );
    const intent = { kind, input };
    const caller = yield* operationCaller(deps, actor, input.operationId, intent);
    let record = caller.record;
    if (record === null) {
      if (caller.claims === null || actor.capability === "recovery")
        return yield* Effect.fail(officeFailure("FORBIDDEN", input.operationId));
      const raw = yield* deps.metadata.draft(caller.claims.owner, input.draftId);
      if (raw === null) return yield* Effect.fail(officeFailure("NOT_FOUND", input.operationId));
      const draft = yield* decodeWire(StoredDraft)(raw).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED", input.operationId)),
      );
      const resolved = yield* resolveTarget(deps, caller.claims, {
        documentId: draft.documentId,
        scope: { kind: "draft", draftId: input.draftId, generation: input.generation },
      });
      yield* authorize(deps, actor, kind, resolved.target, input.operationId);
      record = yield* reserveOperation(deps, caller.claims, intent, resolved.document, draft);
    }
    const original = record;
    return yield* progressTransition(
      deps,
      runtime,
      original,
      actor.capability === "recovery" ? "recovery-dispatch" : "final-commit",
    ).pipe(
      Effect.catch((error) => {
        if (
          ["FORBIDDEN", "UNAUTHENTICATED", "IDEMPOTENCY_CONFLICT", "INVALID_INPUT"].includes(
            error.code,
          )
        )
          return Effect.fail(error);
        return Effect.gen(function* () {
          const retained = yield* transitionFailure(deps, original, error);
          return retained === null ? yield* Effect.fail(error) : retained;
        });
      }),
    );
  });
  return {
    reopen: (actor, input) => transition("reopen", actor, input),
    discard: (actor, input) => transition("discard", actor, input),
  };
}
