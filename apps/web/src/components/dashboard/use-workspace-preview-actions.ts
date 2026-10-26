import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { activatePreview, closePreview } from "./workspace-preview-model";
import { updateView, type WorkspaceViews } from "./workspace-preview-views";
import { useWorkspacePreviewOpen } from "./use-workspace-preview-open";

type Options = {
  scope: RefObject<{ selectedId: string | null; active: boolean }>;
  setViews: Dispatch<SetStateAction<WorkspaceViews>>;
  activeId: string;
  readViews: () => WorkspaceViews;
  reserved: () => number;
  report: (message: string) => void;
  leave: (chatId: string, id: string) => Promise<boolean>;
  cancelFiles: (chatId: string, fileIds: readonly string[]) => void;
};
const nextId = () => `workspace-tab-${crypto.randomUUID()}`;

/**
 * Workspace actions for the selected chat. Each one mutates only its own chat's retained view;
 * reveal/focus is granted only to the chat that is on screen, and a new native tab is admitted
 * through that chat's command scope instead of a workspace-wide mutex.
 */
export function useWorkspacePreviewActions({
  scope,
  setViews,
  activeId,
  readViews,
  reserved,
  report,
  leave,
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
  // Tab focus and re-click are not destructive: retained editors keep their sessions.
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
  /** Closing finishes and drains only this tab's editor, even if another chat is selected now. */
  const close = (id: string) => {
    const chatId = scope.current.selectedId;
    if (chatId === null) return;
    void leave(chatId, id).then((allowed) => {
      if (!allowed) return undefined;
      const tab = readViews()[chatId]?.tabs.find((value) => value.id === id);
      if (tab) {
        const aliases = "attachments" in tab ? tab.attachments : [];
        const descriptor = tab.kind === "restoring" ? tab.descriptor : null;
        cancelFiles(chatId, [
          ...aliases,
          ...("file" in tab ? [tab.file.id] : []),
          ...(descriptor && "fileId" in descriptor ? [descriptor.fileId] : []),
          ...(descriptor?.kind === "office" ? descriptor.attachments : []),
        ]);
      }
      const replacement = nextId();
      setViews((current) =>
        updateView(current, chatId, (view) => closePreview(view, id, replacement)),
      );
      return undefined;
    });
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
  const { openImage, openImageIn, openOffice, openOfficeIn } = useWorkspacePreviewOpen({
    scope,
    setViews,
    readViews,
    reserved,
    report,
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
    openOffice,
    openOfficeIn,
    registerReveal,
  };
}
