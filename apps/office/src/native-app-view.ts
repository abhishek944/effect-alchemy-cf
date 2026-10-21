import { Clock, Effect } from "effect";
import {
  Id,
  OfficeForbidden,
  OfficeUnavailable,
  decodeWire,
  safeFailure,
} from "@starter/office-contract";
import { HostDocumentRecord, HostViewRecord } from "@starter/office-server/native-remote";
import type { OfficeDependencies, OwnerScope } from "@starter/office-server/ports";
const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
const sameOwner = (left: OwnerScope, right: OwnerScope) =>
  left.stage === right.stage && left.ownerId === right.ownerId;

/** Actual active View only; original protocol callbacks still recheck session and placement. */
export const resolveNativeView = Effect.fn("Office.app.resolveView")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  viewId: string,
  signal: AbortSignal,
) {
  if (signal.aborted) return yield* Effect.fail(unavailable());
  const id = yield* decodeWire(Id)(viewId).pipe(Effect.mapError(forbidden));
  const saved = yield* deps.metadata.view(owner, id);
  if (saved === null) return yield* Effect.fail(forbidden());
  const view = yield* decodeWire(HostViewRecord)(saved).pipe(Effect.mapError(forbidden));
  const rawDocument = yield* deps.metadata.document(owner, view.target.documentId);
  if (rawDocument === null) return yield* Effect.fail(forbidden());
  const document = yield* decodeWire(HostDocumentRecord)(rawDocument).pipe(
    Effect.mapError(forbidden),
  );
  if (
    !sameOwner(view.owner, owner) ||
    !sameOwner(view.target.owner, owner) ||
    !sameOwner(document.owner, owner) ||
    view.view.id !== id ||
    document.document.id !== view.target.documentId ||
    view.view.documentId !== view.target.documentId ||
    document.unitId !== view.target.unitId ||
    view.view.nativeTarget.unitId !== view.target.unitId ||
    document.document.kind !== view.view.kind
  )
    return yield* Effect.fail(forbidden());
  const target = view.target;
  if (target.scope.kind === "draft") {
    const draft = yield* deps.metadata.draft(owner, target.scope.draftId);
    if (
      draft === null ||
      !sameOwner(draft.owner, owner) ||
      draft.id !== target.scope.draftId ||
      draft.documentId !== target.documentId ||
      draft.generation !== target.scope.generation ||
      (view.view.nativeTarget.kind === "draft" &&
        (view.view.nativeTarget.worktreeId !== draft.worktreeId ||
          view.view.nativeTarget.generation !== draft.generation))
    )
      return yield* Effect.fail(forbidden());
  }
  if (
    (view.view.nativeTarget.kind === "main" && target.scope.kind !== "main") ||
    (view.view.nativeTarget.kind === "draft" && target.scope.kind !== "draft")
  )
    return yield* Effect.fail(forbidden());
  const state = yield* deps.authority.current(owner, target.documentId);
  const now = yield* Clock.currentTimeMillis;
  if (
    signal.aborted ||
    view.view.expiresAt <= now ||
    state.authorityEpoch !== view.authorityEpoch ||
    state.serviceEpoch !== view.serviceEpoch
  )
    return yield* Effect.fail(forbidden());
  return Object.freeze({
    ...view,
    owner,
    target: Object.freeze({ ...target, owner, scope: Object.freeze({ ...target.scope }) }),
    view: Object.freeze({
      ...view.view,
      nativeTarget: Object.freeze({ ...view.view.nativeTarget }),
    }),
    source: Object.freeze(
      view.source.kind === "artifact"
        ? { ...view.source, artifact: Object.freeze({ ...view.source.artifact }) }
        : { ...view.source },
    ),
  });
});
