import { Effect } from "effect";
import { UniverType } from "@univerjs/protocol";
import { Target, decodeWire } from "@starter/office-contract";
import type { Actor, ActorClaims, OfficeDependencies } from "../ports/index.ts";
import { authorize, sameOwner } from "./claims.ts";
import { StoredDocument, StoredDraft } from "./record-schemas.ts";
import { nativeCall, officeFailure } from "./failure.ts";

export const nativeTypes = {
  sheet: UniverType.UNIVER_SHEET,
  doc: UniverType.UNIVER_DOC,
  slide: UniverType.UNIVER_SLIDE,
} as const;
export const resolveTarget = Effect.fn("Office.resolveTarget")(function* (
  deps: OfficeDependencies,
  claims: ActorClaims,
  value: Target,
) {
  const input = yield* decodeWire(Target)(value).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  const stored = yield* deps.metadata.document(claims.owner, input.documentId);
  if (stored === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const document = yield* decodeWire(StoredDocument)(stored).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (!sameOwner(claims.owner, document.owner) || document.document.id !== input.documentId)
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const target = {
    owner: claims.owner,
    documentId: input.documentId,
    unitId: document.unitId,
    scope: input.scope,
  };
  let worktreeId: string | null = null;
  if (input.scope.kind === "draft") {
    const source = yield* deps.metadata.draft(claims.owner, input.scope.draftId);
    if (source === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
    const draft = yield* decodeWire(StoredDraft)(source).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    if (!sameOwner(claims.owner, draft.owner) || draft.documentId !== input.documentId)
      return yield* Effect.fail(officeFailure("FORBIDDEN"));
    if (draft.generation !== input.scope.generation)
      return yield* Effect.fail(officeFailure("STALE_BASIS"));
    worktreeId = draft.worktreeId;
  } else if (document.location !== "main")
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return { document, target, worktreeId };
});
export const resolveLiveState = Effect.fn("Office.resolveLiveState")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  input: Target,
) {
  const claims = yield* authorize(deps, actor, "read", null);
  const resolved = yield* resolveTarget(deps, claims, input);
  yield* authorize(deps, actor, "read", resolved.target);
  const epochs = yield* deps.authority.current(claims.owner, input.documentId);
  const state = yield* Effect.scoped(
    Effect.gen(function* () {
      const pair = yield* deps.native({ kind: "read", target: resolved.target, ...epochs });
      const context = { userID: claims.owner.ownerId, customData: {}, request: {} };
      const worktreeId = resolved.worktreeId;
      if (worktreeId !== null) {
        const aggregate = yield* nativeCall(() => pair.worktrees.getWorktree(context, worktreeId));
        const unit = aggregate?.units.find((item) => item.unitID === resolved.target.unitId);
        if (
          !aggregate ||
          !unit ||
          unit.removed === true ||
          aggregate.worktree.status === "discarded"
        )
          return yield* Effect.fail(officeFailure("NOT_FOUND"));
        return {
          revision: unit.draftHeadRevision,
          editable: aggregate.worktree.status === "draft",
          type: unit.type,
        };
      }
      const unit = yield* nativeCall(() => pair.core.getUnit(context, resolved.target.unitId));
      if (unit === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
      return { revision: unit.headRevision, editable: true, type: unit.type };
    }),
  );
  if (state.type !== nativeTypes[resolved.document.document.kind])
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return { claims, ...resolved, ...epochs, state };
});
