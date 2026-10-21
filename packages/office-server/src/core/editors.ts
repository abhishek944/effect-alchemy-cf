import { Clock, Effect } from "effect";
import { Editor, EditorAction, decodeWire } from "@starter/office-contract";
import type { HumanActor, OfficeDependencies } from "../ports/index.ts";
import { authorize } from "./claims.ts";
import { lookupView, openRecord } from "./views.ts";
import { resolveLiveState } from "./target.ts";
import { officeFailure } from "./failure.ts";

export const makeOfficeEditors = (deps: OfficeDependencies) => ({
  editor: Effect.fn("Office.editor")(function* (actor: HumanActor, value: EditorAction) {
    if (actor.capability !== "human") return yield* Effect.fail(officeFailure("FORBIDDEN"));
    const input = yield* decodeWire(EditorAction)(value).pipe(
      Effect.mapError(() => officeFailure("INVALID_INPUT")),
    );
    const claims = yield* authorize(deps, actor, input.kind === "revoke" ? "revoke" : "read", null);
    if (input.kind === "acquire") {
      const resolved = yield* openRecord(deps, actor, input.target);
      const editor = yield* deps.metadata.changeEditor(claims.owner, input, null, resolved);
      return yield* decodeWire(Editor)(editor).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
      );
    }
    const previous = yield* deps.metadata.editor(claims.owner, input.editorId);
    if (previous === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
    const editor = yield* decodeWire(Editor)(previous).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    if (input.kind === "renew") {
      const record = yield* lookupView(deps, actor, editor.view.id);
      const current = yield* resolveLiveState(deps, actor, {
        documentId: record.target.documentId,
        scope: record.target.scope,
      });
      if (
        editor.state !== "active" ||
        record.authorityEpoch !== current.authorityEpoch ||
        record.serviceEpoch !== current.serviceEpoch ||
        (record.view.mode === "edit" && !current.state.editable)
      )
        return yield* Effect.fail(officeFailure("NOT_EDITABLE"));
      const now = yield* Clock.currentTimeMillis;
      const renewed = {
        ...record,
        view: { ...record.view, expiresAt: Math.min(claims.expiresAt, now + 300_000) },
      };
      return yield* deps.metadata.changeEditor(claims.owner, input, editor.epoch, renewed);
    }
    if (input.kind === "drained") {
      const record = yield* lookupView(deps, actor, editor.view.id);
      const current = yield* resolveLiveState(deps, actor, {
        documentId: record.target.documentId,
        scope: record.target.scope,
      });
      if (
        input.confirmedRevision !== current.state.revision ||
        record.authorityEpoch !== current.authorityEpoch ||
        record.serviceEpoch !== current.serviceEpoch
      )
        return yield* Effect.fail(officeFailure("STALE_BASIS"));
    }
    return yield* deps.metadata.changeEditor(claims.owner, input, editor.epoch, null);
  }),
});
