import { Clock, Effect } from "effect";
import { Editor, decodeWire } from "@starter/office-contract";
import type { IBatchAllowedResponse } from "@univerjs/protocol";
import type { HumanActor, OfficeDependencies } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "../core/native-runtime.ts";
import { lookupView } from "../core/views.ts";
import { resolveLiveState } from "../core/target.ts";
import { materializeNativeSnapshot, materializeView } from "../core/input.ts";
import { nativeCall, officeFailure } from "../core/failure.ts";
import { BatchAllowed } from "./permission-schema.ts";
import { nativePermissionObjects } from "./objects.ts";
import { nativeReadableActions, nativeEditableActions } from "./permission-policy.ts";

/** Server-resolved View/current editor identities, never selected by native request-body Unit IDs. */
export const evaluateViewPermissions = Effect.fn("Office.evaluateViewPermissions")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: HumanActor,
  viewId: string,
  editorId: string | null,
  body: unknown,
) {
  if (actor.capability !== "human") return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const record = yield* lookupView(deps, actor, viewId);
  const request = yield* decodeWire(BatchAllowed)(body).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  const now = yield* Clock.currentTimeMillis;
  const pinned = record.view.nativeTarget.kind === "pinned-snapshot";
  let editable = false;
  let native;
  if (pinned) native = yield* materializeView(deps, runtime, record);
  else {
    const live = yield* resolveLiveState(deps, actor, {
      documentId: record.target.documentId,
      scope: record.target.scope,
    });
    native = yield* materializeNativeSnapshot(
      deps,
      runtime,
      {
        kind: "read",
        target: record.target,
        authorityEpoch: record.authorityEpoch,
        serviceEpoch: record.serviceEpoch,
      },
      live.worktreeId,
      record.view.kind,
      live.state.revision,
    );
    if (editorId !== null && live.state.editable && record.view.mode === "edit") {
      const value = yield* deps.metadata.editor(record.owner, editorId);
      const editor = yield* decodeWire(Editor)(value).pipe(
        Effect.mapError(() => officeFailure("FORBIDDEN")),
      );
      editable =
        editor.id === editorId &&
        editor.view.id === viewId &&
        editor.state === "active" &&
        editor.expiresAt > now &&
        editor.view.expiresAt > now;
    }
  }
  const objects = yield* nativeCall(() =>
    Promise.resolve(nativePermissionObjects(record.view.kind, native)),
  );
  const response: IBatchAllowedResponse = {
    error: undefined,
    objectActions: request.requests.map((item) => ({
      unitID: item.unitID,
      objectID: item.objectID,
      actions: item.actions.map((action) => ({
        action,
        allowed:
          item.unitID === record.target.unitId &&
          objects.get(item.objectType)?.has(item.objectID) === true &&
          (nativeReadableActions.has(action) || (editable && nativeEditableActions.has(action))),
      })),
    })),
  };
  return response;
});
