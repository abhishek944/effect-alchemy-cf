import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { activatePreview, closePreview } from "./workspace-preview-model";
import { updateView, type WorkspaceViews } from "./workspace-preview-views";
import { useWorkspacePreviewOpen } from "./use-workspace-preview-open";

type Options = {
  scope: RefObject<{ selectedId: string | null; active: boolean }>;
  setViews: Dispatch<SetStateAction<WorkspaceViews>>;
  activeId: string;
  readViews: () => WorkspaceViews;
  cancelFiles: (chatId: string, fileIds: readonly string[]) => void;
};
const nextId = () => `workspace-tab-${crypto.randomUUID()}`;

/**
 * Workspace actions for the selected chat. Each one mutates only its own chat's retained view;
 * reveal/focus is granted only to the chat that is on screen.
 */
export function useWorkspacePreviewActions({
  scope,
  setViews,
  activeId,
  readViews,
  cancelFiles,
}: Options) {
  const reveal = useRef<(() => void) | null>(null);
  const registerReveal = useCallback((callback: () => void) => {
    reveal.current = callback;
    return () => {
      if (reveal.current === callback) reveal.current = null;
    };
  }, []);
  const revealFor = useCallback(
    (chatId: string) => {
      // Hidden chats and non-dashboard routes publish without taking foreground focus.
      if (scope.current.active && chatId === scope.current.selectedId) reveal.current?.();
    },
    [scope],
  );
  // Tab focus and re-click are not destructive: retained views keep their sessions.
  const select = (id: string) => {
    const chatId = scope.current.selectedId;
    if (chatId === null || id === activeId) return;
    setViews((current) =>
      updateView(current, chatId, (view) => {
        const tab = view.tabs.find((value) => value.id === id);
        return tab === undefined ? view : activatePreview(view, tab);
      }),
    );
  };
  const show = useCallback(
    (chatId: string, id: string) => {
      setViews((current) =>
        updateView(current, chatId, (view) => {
          const tab = view.tabs.find((value) => value.id === id);
          return tab === undefined ? view : activatePreview(view, tab);
        }),
      );
      revealFor(chatId);
    },
    [revealFor, setViews],
  );
  /** Closing abandons only this tab's pending reads, even if another chat is selected now. */
  const close = (id: string) => {
    const chatId = scope.current.selectedId;
    if (chatId === null) return;
    const tab = readViews()[chatId]?.tabs.find((value) => value.id === id);
    if (tab) {
      const descriptor = tab.kind === "restoring" ? tab.descriptor : null;
      cancelFiles(chatId, [
        ...("file" in tab ? [tab.file.id] : []),
        ...(descriptor && "fileId" in descriptor ? [descriptor.fileId] : []),
      ]);
    }
    const replacement = nextId();
    setViews((current) =>
      updateView(current, chatId, (view) => closePreview(view, id, replacement)),
    );
  };
  const add = () => {
    const chatId = scope.current.selectedId;
    if (chatId === null) return;
    const id = nextId();
    setViews((current) =>
      updateView(current, chatId, (view) => activatePreview(view, { id, kind: "tools" })),
    );
    revealFor(chatId);
  };
  const showFiles = () => {
    const chatId = scope.current.selectedId;
    if (chatId === null) return;
    setViews((current) =>
      updateView(current, chatId, (view) => ({
        ...view,
        tabs: view.tabs.map((tab) =>
          tab.id === view.activeId ? { id: tab.id, kind: "files" } : tab,
        ),
        focus: { sequence: view.focus.sequence + 1, target: "tab" },
      })),
    );
    revealFor(chatId);
  };
  const { openImage, openImageIn } = useWorkspacePreviewOpen({
    scope,
    setViews,
    readViews,
    reveal: revealFor,
  });
  return {
    select,
    show,
    close,
    add,
    showFiles,
    openImage,
    openImageIn,
    registerReveal,
  };
}
