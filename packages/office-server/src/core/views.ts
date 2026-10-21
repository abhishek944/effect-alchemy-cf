import { randomUUID } from "node:crypto";
import { Clock, Effect } from "effect";
import { View, decodeWire, type NativeViewTarget, type Target } from "@starter/office-contract";
import type { Actor, OfficeDependencies, ViewRecord } from "../ports/index.ts";
import { authorize, sameOwner } from "./claims.ts";
import { resolveLiveState } from "./target.ts";
import { officeFailure } from "./failure.ts";
import { StoredView } from "./record-schemas.ts";

export const openRecord = Effect.fn("Office.openRecord")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  input: Target,
) {
  const resolved = yield* resolveLiveState(deps, actor, input);
  const now = yield* Clock.currentTimeMillis;
  const id = randomUUID();
  let nativeTarget: NativeViewTarget;
  if (!resolved.state.editable)
    nativeTarget = { kind: "pinned-snapshot", unitId: resolved.target.unitId };
  else if (resolved.target.scope.kind === "draft") {
    if (resolved.worktreeId === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    nativeTarget = {
      kind: "draft",
      unitId: resolved.target.unitId,
      worktreeId: resolved.worktreeId,
      generation: resolved.target.scope.generation,
    };
  } else nativeTarget = { kind: "main", unitId: resolved.target.unitId };
  const view = yield* decodeWire(View)({
    id,
    documentId: input.documentId,
    kind: resolved.document.document.kind,
    revision: resolved.state.revision,
    nativeTarget,
    mode: resolved.state.editable ? "edit" : "read-only",
    protocolPrefix: resolved.state.editable ? "/universer-api" : `/api/office/views/${id}/protocol`,
    expiresAt: Math.min(resolved.claims.expiresAt, now + 300_000),
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
  const record: ViewRecord = {
    owner: resolved.claims.owner,
    view,
    target: resolved.target,
    authorityEpoch: resolved.authorityEpoch,
    serviceEpoch: resolved.serviceEpoch,
    source:
      resolved.worktreeId === null
        ? { kind: "core", revision: resolved.state.revision }
        : { kind: "draft", worktreeId: resolved.worktreeId, revision: resolved.state.revision },
  };
  const stored = yield* deps.metadata.putView(record);
  return yield* decodeWire(StoredView)(stored).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
});
export const lookupView = Effect.fn("Office.lookupView")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  viewId: string,
) {
  const claims = yield* authorize(deps, actor, "read", null);
  const raw = yield* deps.metadata.view(claims.owner, viewId);
  if (raw === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const record = yield* decodeWire(StoredView)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    !sameOwner(record.owner, claims.owner) ||
    record.view.id !== viewId ||
    record.target.documentId !== record.view.documentId ||
    record.target.unitId !== record.view.nativeTarget.unitId
  )
    return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const now = yield* Clock.currentTimeMillis;
  if (record.view.expiresAt <= now) return yield* Effect.fail(officeFailure("UNAUTHENTICATED"));
  yield* authorize(deps, actor, "read", record.target);
  const epoch = yield* deps.authority.current(claims.owner, record.target.documentId);
  if (epoch.authorityEpoch !== record.authorityEpoch || epoch.serviceEpoch !== record.serviceEpoch)
    return yield* Effect.fail(officeFailure("AUTHORITY_LOST"));
  return record;
});
export const makeOfficeViews = (deps: OfficeDependencies) => ({
  open: (actor: Actor, input: Target) =>
    openRecord(deps, actor, input).pipe(Effect.map((record) => record.view)),
});
