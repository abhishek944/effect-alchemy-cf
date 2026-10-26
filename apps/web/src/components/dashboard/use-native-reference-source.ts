import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { freezeOfficeSendTarget, type OfficeSendTarget } from "@starter/office-contract";
import type {
  NativeSelectionCapture,
  OfficeEditorHandle,
  OfficeRuntime,
} from "@starter/office-react";
import { captureOfficeCheckpoint, officeSendAnchor } from "@/lib/office-anchor";
import type { OpenOffice } from "@/lib/office-runtime";
import { resumeOfficeReference } from "@/lib/office-reference-resume";
import type { OfficeSelection } from "./workspace-preview-model";
import { useWorkspaceOffice } from "./workspace-office-context";
import { panelKey } from "./workspace-office-scope";
import { useWorkspacePreview } from "./workspace-preview-context";
import { useReferenceWorkspace } from "./reference-workspace";
import { nativeReferenceKey } from "./reference-types";
export type NativeReferenceState = {
  current: () => OpenOffice | null;
  canResume: () => boolean;
  blocked: () => boolean;
  signal: () => AbortSignal | null;
};
const canReference = (state: NativeReferenceState) => {
  const opened = state.current();
  return (
    opened !== null &&
    opened.view.expiresAt > Date.now() &&
    ((opened.editor === null && opened.view.mode === "read-only") || state.canResume())
  );
};
type Options = {
  chatId: string;
  id: string;
  selection: OfficeSelection;
  opened: OpenOffice | null;
  runtime: OfficeRuntime | null;
  handle: OfficeEditorHandle | null;
  state: NativeReferenceState;
  report: (message: string) => void;
};

/** One mounted source owns checkpointing; observed selections never enter Send automatically. */
export function useNativeReferenceSource(options: Options) {
  const { registerSource, observe } = useReferenceWorkspace();
  const { beginCommand } = useWorkspaceOffice();
  const { show } = useWorkspacePreview();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const view = options.opened?.view;
  const target = useMemo<OfficeSendTarget | null>(() => {
    if (
      !view ||
      view.nativeTarget.kind === "pinned-snapshot" ||
      options.selection.reviewId !== null
    )
      return null;
    const common = {
      viewId: view.id,
      documentId: view.documentId,
      documentKind: view.kind,
      expectedRevision: view.revision,
    };
    const scope = options.selection.target.scope;
    return freezeOfficeSendTarget(
      scope.kind === "main"
        ? { kind: "main", ...common }
        : { kind: "draft", ...common, draftId: scope.draftId, generation: scope.generation },
    );
  }, [view, options.selection]);
  const key = target === null ? null : nativeReferenceKey(target);
  const prepare = useCallback(
    async (capture: NativeSelectionCapture | null) => {
      const source = latest.current;
      const opened = source.state.current();
      const { handle, runtime } = source;
      const signal = source.state.signal();
      if (
        !opened ||
        !handle ||
        !runtime ||
        !signal ||
        source.state.blocked() ||
        !canReference(source.state)
      )
        throw new Error("This native source is not ready for a reference.");
      const release = beginCommand(panelKey(source.chatId, source.id));
      if (!release) throw new Error("Finish the current Office save before adding a reference.");
      const assertSource = () => {
        signal.throwIfAborted();
        const current = latest.current;
        if (
          current.chatId !== source.chatId ||
          current.id !== source.id ||
          current.handle !== handle ||
          current.state.current()?.view.id !== opened.view.id ||
          current.state.blocked() ||
          !canReference(current.state)
        )
          throw new Error("The native reference source changed. Select it again.");
      };
      let acknowledged = false;
      try {
        assertSource();
        const saved = capture ? await handle.prepareCapture(capture) : await handle.hold();
        acknowledged = true;
        assertSource();
        const checkpoint = await captureOfficeCheckpoint(
          runtime,
          source.selection.target,
          opened,
          saved,
          signal,
        );
        if (capture) await handle.validateCapture(capture);
        assertSource();
        const result = officeSendAnchor(
          opened,
          saved,
          checkpoint,
          source.selection.target,
          undefined,
        );
        if (!result) throw new Error("This native source cannot seed an editable reference.");
        return result;
      } catch (error) {
        source.report(
          error instanceof Error
            ? error.message
            : "Native capture is unconfirmed. Keep the editor open.",
        );
        throw error;
      } finally {
        try {
          // A failed hold is uncertain. Resume only our acknowledged hold under still-live authority.
          if (acknowledged && source.state.canResume() && latest.current.handle === handle) {
            await resumeOfficeReference(handle, source.state.canResume, source.report);
          }
        } finally {
          release();
        }
      }
    },
    [beginCommand],
  );
  const reveal = useCallback(
    async (capture: NativeSelectionCapture | null) => {
      const source = latest.current;
      const handle = source.handle;
      const viewId = source.state.current()?.view.id;
      if (!handle || !viewId || source.state.blocked())
        throw new Error("This native source is unavailable.");
      show(source.chatId, source.id);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (latest.current.handle !== handle || latest.current.state.current()?.view.id !== viewId)
        throw new Error("The native source changed before it could be shown.");
      if (capture) await handle.revealCapture(capture);
    },
    [show],
  );
  useLayoutEffect(() => {
    if (!target || key === null || !options.handle || !options.runtime) return undefined;
    return registerSource({
      chatId: options.chatId,
      key,
      name: options.selection.title,
      kind: "native",
      target,
      prepare,
      reveal,
    });
  }, [
    registerSource,
    options.chatId,
    options.selection.title,
    options.handle,
    options.runtime,
    key,
    target,
    prepare,
    reveal,
  ]);
  return useCallback(
    (capture: NativeSelectionCapture) => {
      if (key === null || capture.viewId !== latest.current.state.current()?.view.id) return;
      observe({
        kind: "native",
        chatId: latest.current.chatId,
        sourceKey: key,
        captureId: capture.captureId,
        capture,
      });
    },
    [key, observe],
  );
}
