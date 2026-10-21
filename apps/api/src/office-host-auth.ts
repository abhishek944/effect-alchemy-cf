import { Effect } from "effect";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import type { OfficeHostEntry, OfficeHostRuntime } from "./office-host-state.ts";

/** Caller FIRST establishes private API or original physical callback audience, never ID authentication. */
export const officeHostOriginal = (root: OfficeHostRuntime, id: string) =>
  root.registry.resolve(id);

export const assertOfficeHostFrame = (root: OfficeHostRuntime, entry: OfficeHostEntry) =>
  Effect.gen(function* () {
    const frame = entry.frame;
    if (
      root.closing ||
      frame.isClosed ||
      frame.io.isRevoked ||
      frame.work.signal.aborted ||
      frame.deadline <= Date.now() ||
      entry.resolution.deadline <= Date.now()
    )
      return yield* Effect.fail(officeDenied());
    const original = yield* root.registry.resolve(frame.original.actor.invocationId);
    if (original !== frame.original) return yield* Effect.fail(officeDenied());
    if (entry.resolution.view !== null) {
      const active = yield* Effect.tryPromise({ try: () => root.active(), catch: officeDenied });
      const actual = yield* active.metadata.view(root.owner, entry.resolution.view.view.id);
      if (
        actual === null ||
        actual.view.expiresAt <= Date.now() ||
        !officeSame(actual, entry.resolution.view)
      )
        return yield* Effect.fail(officeDenied());
      if (entry.resolution.editorId !== null) {
        const editor = yield* active.metadata.editor(root.owner, entry.resolution.editorId);
        if (
          editor === null ||
          editor.state !== "active" ||
          editor.expiresAt <= Date.now() ||
          editor.view.id !== actual.view.id
        )
          return yield* Effect.fail(officeDenied());
      }
    }
    if (frame.work.signal.aborted || frame.isClosed) return yield* Effect.fail(officeDenied());
    return undefined;
  });

export function officeHostCleanup(entry: OfficeHostEntry): void {
  if (entry.frame.cleanup.signal.aborted || entry.frame.cleanupDeadline <= Date.now())
    throw officeDenied();
}
