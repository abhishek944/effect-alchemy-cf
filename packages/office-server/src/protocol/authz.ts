import { Clock, Effect } from "effect";
import { Editor, decodeWire } from "@starter/office-contract";
import { UniverType, UnitObject, type IBatchAllowedResponse } from "@univerjs/protocol";
import type { HumanActor, NativeTarget, OfficeDependencies } from "../ports/index.ts";
import { authorize } from "../core/claims.ts";
import { nativeCall, officeFailure } from "../core/failure.ts";

import { BatchAllowed } from "./permission-schema.ts";
import {
  nativeReadableActions as readable,
  nativeEditableActions as editable,
} from "./permission-policy.ts";
/** Obtained from signed host/current editor routing, NEVER selected by request body Unit IDs. */
export type PermissionChannel = {
  readonly editorId: string;
  readonly target: NativeTarget;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
};
export const evaluateNativePermissions = Effect.fn("Office.evaluateNativePermissions")(function* (
  deps: OfficeDependencies,
  actor: HumanActor,
  channel: PermissionChannel,
  body: unknown,
) {
  if (actor.capability !== "human") return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const claims = yield* authorize(deps, actor, "read", channel.target);
  const request = yield* decodeWire(BatchAllowed)(body).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  const editorValue = yield* deps.metadata.editor(claims.owner, channel.editorId);
  if (editorValue === null) return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const editor = yield* decodeWire(Editor)(editorValue).pipe(
    Effect.mapError(() => officeFailure("FORBIDDEN")),
  );
  const now = yield* Clock.currentTimeMillis;
  const view = editor.view;
  if (
    editor.id !== channel.editorId ||
    editor.expiresAt <= now ||
    view.expiresAt <= now ||
    editor.state === "revoked" ||
    editor.state === "unclean" ||
    view.documentId !== channel.target.documentId ||
    view.nativeTarget.kind === "pinned-snapshot" ||
    view.nativeTarget.unitId !== channel.target.unitId
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const document = yield* deps.metadata.document(claims.owner, view.documentId);
  if (document === null || document.unitId !== channel.target.unitId)
    return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const epoch = yield* deps.authority.current(claims.owner, view.documentId);
  if (
    epoch.authorityEpoch !== channel.authorityEpoch ||
    epoch.serviceEpoch !== channel.serviceEpoch
  )
    return yield* Effect.fail(officeFailure("AUTHORITY_LOST"));
  let worktreeId: string | null = null;
  if (channel.target.scope.kind === "draft") {
    const draft = yield* deps.metadata.draft(claims.owner, channel.target.scope.draftId);
    if (
      draft === null ||
      draft.documentId !== view.documentId ||
      draft.generation !== channel.target.scope.generation ||
      view.nativeTarget.kind !== "draft" ||
      draft.worktreeId !== view.nativeTarget.worktreeId ||
      draft.generation !== view.nativeTarget.generation
    )
      return yield* Effect.fail(officeFailure("FORBIDDEN"));
    worktreeId = draft.worktreeId;
  } else if (view.nativeTarget.kind !== "main" || document.location !== "main")
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const target = channel.target;
  const nativeState = yield* Effect.scoped(
    Effect.gen(function* () {
      const pair = yield* deps.native({ kind: "read", target, ...epoch });
      const context = { userID: claims.owner.ownerId, customData: {}, request: {} };
      if (worktreeId !== null) {
        const aggregate = yield* nativeCall(() => pair.worktrees.getWorktree(context, worktreeId));
        const unit = aggregate?.units.find((item) => item.unitID === target.unitId);
        if (!unit || aggregate?.worktree.status === "discarded")
          return yield* Effect.fail(officeFailure("NOT_FOUND"));
        return {
          type: unit.type,
          editable: aggregate?.worktree.status === "draft" && unit.removed !== true,
        };
      }
      const unit = yield* nativeCall(() => pair.core.getUnit(context, target.unitId));
      if (unit === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
      return { type: unit.type, editable: true };
    }),
  );
  const canEdit = editor.state === "active" && view.mode === "edit" && nativeState.editable;
  const objectType =
    nativeState.type === UniverType.UNIVER_SHEET
      ? UnitObject.Workbook
      : nativeState.type === UniverType.UNIVER_DOC
        ? UnitObject.Document
        : UnitObject.Slide;
  const result: IBatchAllowedResponse = {
    error: undefined,
    objectActions: request.requests.map((item) => ({
      unitID: item.unitID,
      objectID: item.objectID,
      actions: item.actions.map((action) => ({
        action,
        allowed:
          item.unitID === target.unitId &&
          item.objectID === target.unitId &&
          item.objectType === objectType &&
          (readable.has(action) || (canEdit && editable.has(action))),
      })),
    })),
  };
  return result;
});
