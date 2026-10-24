import { Effect } from "effect";
import { officeCaught, officeSameView } from "./office-private-authority.ts";
import { officeDeny } from "./office-diagnostic-report.ts";
import type { OfficeHostEntry, OfficeHostRuntime } from "./office-host-state.ts";

/** Caller FIRST establishes private API or original physical callback audience, never ID authentication. */
export const officeHostOriginal = (root: OfficeHostRuntime, id: string) =>
  root.registry.resolve(id);

/** Fixed frame-liveness reasons; each denial is reported once where the frame is actually rejected. */
export const assertOfficeHostFrame = (root: OfficeHostRuntime, entry: OfficeHostEntry) =>
  Effect.gen(function* () {
    const frame = entry.frame;
    const deny = (reason: string) =>
      officeDeny({
        component: "office.host",
        operation: "frame-assert",
        operationId: frame.original.actor.invocationId,
        reason,
      });
    if (root.closing) return yield* Effect.fail(deny("host-closing"));
    if (frame.isClosed || frame.work.signal.aborted)
      return yield* Effect.fail(deny("frame-closed"));
    if (frame.io.isRevoked) return yield* Effect.fail(deny("frame-revoked"));
    if (frame.deadline <= Date.now() || entry.resolution.deadline <= Date.now())
      return yield* Effect.fail(deny("frame-deadline"));
    const original = yield* root.registry.resolve(frame.original.actor.invocationId);
    if (original !== frame.original) return yield* Effect.fail(deny("original-mismatch"));
    if (entry.resolution.view !== null) {
      const active = yield* Effect.tryPromise({ try: () => root.active(), catch: officeCaught });
      const actual = yield* active.metadata.view(root.owner, entry.resolution.view.view.id);
      if (
        actual === null ||
        actual.view.expiresAt <= Date.now() ||
        !officeSameView(actual, entry.resolution.view)
      )
        return yield* Effect.fail(deny("view-stale"));
      if (entry.resolution.editorId !== null) {
        const editor = yield* active.metadata.editor(root.owner, entry.resolution.editorId);
        if (
          editor === null ||
          editor.state !== "active" ||
          editor.expiresAt <= Date.now() ||
          editor.view.id !== actual.view.id
        )
          return yield* Effect.fail(deny("editor-inactive"));
      }
    }
    if (frame.work.signal.aborted || frame.isClosed)
      return yield* Effect.fail(deny("frame-aborted"));
    return undefined;
  });

export function officeHostCleanup(entry: OfficeHostEntry): void {
  if (entry.frame.cleanup.signal.aborted || entry.frame.cleanupDeadline <= Date.now())
    throw officeDeny({
      component: "office.host",
      operation: "frame-cleanup",
      operationId: entry.frame.original.actor.invocationId,
      reason: "cleanup-deadline",
    });
}
