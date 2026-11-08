import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { restorePreview, storePreview } from "./workspace-session";
import { useWorkspacePreviewActions } from "./use-workspace-preview-actions";
import { useChatOpenReads, type ChatOpenRead } from "./use-chat-open-reads";
import { initialPreview } from "./workspace-preview-model";
import type {
  PreviewView,
  WorkspaceImageFile,
  WorkspacePreviewTab,
} from "./workspace-preview-model";
import { updateView, viewEntries, type WorkspaceViews } from "./workspace-preview-views";
export type { WorkspaceImageFile, WorkspacePreviewTab } from "./workspace-preview-model";

type PreviewContext = PreviewView & {
  active: WorkspacePreviewTab;
  /** Every retained chat view; only the selected one is visible. */
  workspaces: readonly { chatId: string; view: PreviewView }[];
  select: (id: string) => void;
  show: (chatId: string, id: string) => void;
  close: (id: string) => void;
  add: () => void;
  showFiles: () => void;
  openImage: (file: WorkspaceImageFile) => void;
  openImageIn: (chatId: string, file: WorkspaceImageFile, show: boolean) => void;
  /** Account-scoped explicit saved-file opens; they outlive the surface that started them. */
  openSavedFile: (chatId: string, fileId: string, reveal: boolean) => void;
  openRead: (chatId: string) => ChatOpenRead | null;
  dismissOpen: (chatId: string, read: ChatOpenRead) => void;
  registerReveal: (reveal: () => void) => () => void;
  restoreTab: (chatId: string, captured: WorkspacePreviewTab, tab: WorkspacePreviewTab) => void;
};
const Context = createContext<PreviewContext | null>(null);
const load = (accountId: string, chatId: string) =>
  restorePreview(accountId, chatId) ?? initialPreview(chatId, "workspace-tab-0");

/**
 * One retained tab hierarchy per visited chat. Switching chats changes which hierarchy is
 * projected and visible; it never unmounts another chat's file view, and a hidden chat can never
 * own the activation slot or steal focus from the one on screen.
 */
export function WorkspacePreviewProvider({
  children,
  active,
  accountId,
}: {
  children: ReactNode;
  active: boolean;
  accountId: string;
}) {
  const { selectedId } = useChatStore();
  const scope = useRef({ selectedId, active });
  useLayoutEffect(() => {
    scope.current = { selectedId, active };
  }, [selectedId, active]);
  const [views, publishViews] = useState<WorkspaceViews>({});
  const viewsRef = useRef<WorkspaceViews>({});
  // Publish each origin-addressed update from the latest committed view snapshot.
  const setViews = useCallback((update: SetStateAction<WorkspaceViews>) => {
    const next = typeof update === "function" ? update(viewsRef.current) : update;
    viewsRef.current = next;
    publishViews(next);
  }, []);
  useLayoutEffect(() => {
    if (selectedId === null || viewsRef.current[selectedId] !== undefined) return;
    setViews((current) => ({ ...current, [selectedId]: load(accountId, selectedId) }));
  }, [accountId, selectedId, setViews]);
  const projected =
    (selectedId === null ? null : views[selectedId]) ??
    initialPreview(selectedId, "workspace-tab-0");
  const stored = useRef(new Map<string, PreviewView>());
  useLayoutEffect(() => {
    for (const [chatId, view] of viewEntries(views)) {
      if (stored.current.get(chatId) === view) continue;
      stored.current.set(chatId, view);
      storePreview(accountId, view);
    }
  }, [accountId, views]);
  const workspaces = viewEntries(views).map(([chatId, view]) => ({ chatId, view }));
  const activeTab = projected.tabs.find((tab) => tab.id === projected.activeId);
  if (activeTab === undefined) throw new Error("The workspace tab selection is inconsistent.");
  const readViews = useCallback(() => viewsRef.current, []);
  const openReads = useChatOpenReads();
  const actions = useWorkspacePreviewActions({
    scope,
    setViews,
    activeId: projected.activeId,
    readViews,
    cancelFiles: openReads.cancelFiles,
  });
  const openRead = useCallback(
    (chatId: string) => openReads.reads[chatId] ?? null,
    [openReads.reads],
  );
  const restoreTab = useCallback(
    (chatId: string, captured: WorkspacePreviewTab, tab: WorkspacePreviewTab) => {
      setViews((current) =>
        updateView(current, chatId, (view) => ({
          ...view,
          tabs: view.tabs.map((value) => (value === captured ? tab : value)),
        })),
      );
    },
    [setViews],
  );
  return (
    <Context.Provider
      value={{
        ...projected,
        active: activeTab,
        workspaces,
        ...actions,
        openSavedFile: (chatId, fileId, show) =>
          openReads.openSavedFile(chatId, fileId, show, actions.openImageIn),
        openRead,
        dismissOpen: openReads.dismiss,
        restoreTab,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspacePreview(): PreviewContext {
  const value = useContext(Context);
  if (value === null) throw new Error("Workspace previews require their workspace provider.");
  return value;
}
