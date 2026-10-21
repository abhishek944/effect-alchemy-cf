import { Clock, Effect } from "effect";
import { decodeWire, type DocumentScope } from "@starter/office-contract";
import { OriginalActorClaims } from "../ports/index.ts";
import type {
  Actor,
  ActorClaims,
  ActorVerification,
  NativeTarget,
  OfficeDependencies,
  OperationRecord,
} from "../ports/index.ts";
import { officeFailure } from "./failure.ts";

export const sameOwner = (a: ActorClaims["owner"], b: ActorClaims["owner"]): boolean =>
  a.ownerId === b.ownerId && a.stage === b.stage;
export const sameScope = (a: DocumentScope, b: DocumentScope): boolean =>
  a.kind === b.kind &&
  (a.kind === "main" ||
    (b.kind === "draft" && a.draftId === b.draftId && a.generation === b.generation));
export const originalClaims = (actor: Actor) =>
  actor.capability === "recovery"
    ? Effect.fail(officeFailure("FORBIDDEN"))
    : decodeWire(OriginalActorClaims)(actor).pipe(
        Effect.mapError(() => officeFailure("FORBIDDEN")),
      );
export type OfficeAction =
  | "discover"
  | "stage"
  | "create"
  | "create-draft"
  | "read"
  | "edit"
  | "ready"
  | "reopen"
  | "discard"
  | "approve"
  | "merge"
  | "revoke";
export const authorize = Effect.fn("Office.authorize")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  action: OfficeAction,
  target: NativeTarget | null,
  operationId: string | null = null,
) {
  const claims = yield* originalClaims(actor);
  const now = yield* Clock.currentTimeMillis;
  if (claims.expiresAt <= now)
    return yield* Effect.fail(officeFailure("UNAUTHENTICATED", operationId));
  if (target !== null && !sameOwner(claims.owner, target.owner))
    return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
  if (claims.capability === "draft-task") {
    if (action === "approve" || action === "merge" || action === "revoke")
      return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
    if (target !== null && !["read", "create", "create-draft"].includes(action)) {
      const bound = claims.target;
      if (
        bound === null ||
        bound.documentId !== target.documentId ||
        target.scope.kind !== "draft" ||
        bound.draftId !== target.scope.draftId ||
        bound.generation !== target.scope.generation
      )
        return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
    }
  }
  yield* deps.verifyActor({ claims, phase: "request", operationId, intentDigest: null, target });
  return claims;
});
export const verifyOperation = Effect.fn("Office.verifyOperation")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  target: NativeTarget,
  phase: Exclude<ActorVerification["phase"], "request">,
) {
  const claims = yield* decodeWire(OriginalActorClaims)(operation.actor).pipe(
    Effect.mapError(() => officeFailure("FORBIDDEN", operation.receipt.operationId)),
  );
  if (
    !sameOwner(operation.owner, claims.owner) ||
    !sameOwner(operation.owner, target.owner) ||
    operation.documentId !== target.documentId ||
    operation.unitId !== target.unitId
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN", operation.receipt.operationId));
  const now = yield* Clock.currentTimeMillis;
  if (phase !== "recovery-observe" && claims.expiresAt <= now)
    return yield* Effect.fail(officeFailure("UNAUTHENTICATED", operation.receipt.operationId));
  if (claims.capability === "draft-task") {
    if (
      operation.intent.kind === "approve" ||
      operation.intent.kind === "merge" ||
      (operation.intent.kind === "create" && operation.intent.input.destination !== "new-draft")
    )
      return yield* Effect.fail(officeFailure("FORBIDDEN", operation.receipt.operationId));
    const preparatory =
      operation.intent.kind === "create" || operation.intent.kind === "create-draft";
    // Render/export produce ordinary artifacts, never native writes. Their original grant still verifies below.
    const readOnly = operation.intent.kind === "render" || operation.intent.kind === "export";
    if (!readOnly && preparatory && target.scope.kind !== "draft")
      return yield* Effect.fail(officeFailure("FORBIDDEN", operation.receipt.operationId));
    if (!readOnly && !preparatory && target.scope.kind !== "draft")
      return yield* Effect.fail(officeFailure("FORBIDDEN", operation.receipt.operationId));
    const bound = claims.target;
    if (
      !readOnly &&
      !preparatory &&
      (bound === null ||
        bound.documentId !== target.documentId ||
        target.scope.kind !== "draft" ||
        bound.draftId !== target.scope.draftId ||
        bound.generation !== target.scope.generation)
    )
      return yield* Effect.fail(officeFailure("FORBIDDEN", operation.receipt.operationId));
  }
  yield* deps.verifyActor({
    claims,
    phase,
    operationId: operation.receipt.operationId,
    intentDigest: operation.intentDigest,
    target,
  });
  return undefined;
});
