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
import { useWorkspaceOffice } from "./workspace-office-context";
import { panelKey } from "./workspace-office-scope";
import { restorePreview, storePreview } from "./workspace-session";
import { useWorkspacePreviewActions } from "./use-workspace-preview-actions";
import { useChatOpenReads, type ChatOpenRead } from "./use-chat-open-reads";
import { initialPreview, resolveOfficePreview } from "./workspace-preview-model";
import type {
  OfficeSelection,
  PreviewView,
  WorkspaceImageFile,
  WorkspacePreviewTab,
} from "./workspace-preview-model";
import {
  MAX_NATIVE_SURFACES,
  nativeSurfaceCount,
  updateView,
  viewEntries,
  type WorkspaceViews,
} from "./workspace-preview-views";
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
  openOffice: (selection: OfficeSelection) => void;
  openOfficeIn: (chatId: string | null, selection: OfficeSelection, show: boolean) => void;
  /** Account-scoped explicit saved-file opens; they outlive the surface that started them. */
  openSavedFile: (chatId: string, fileId: string, reveal: boolean) => void;
  openRead: (chatId: string) => ChatOpenRead | null;
  dismissOpen: (chatId: string, read: ChatOpenRead) => void;
  /** Restoration reserves one aggregate native slot before it hydrates a native descriptor. */
  claimNativeRestore: (chatId: string, tabId: string) => boolean;
  releaseNativeRestore: (chatId: string, tabId: string) => void;
  resolveOffice: (id: string, chatId: string, selection: OfficeSelection) => void;
  registerReveal: (reveal: () => void) => () => void;
  restoreTab: (chatId: string, captured: WorkspacePreviewTab, tab: WorkspacePreviewTab) => void;
};
const Context = createContext<PreviewContext | null>(null);
const load = (accountId: string, chatId: string) =>
  restorePreview(accountId, chatId) ?? initialPreview(chatId, "workspace-tab-0");

/**
 * One retained tab hierarchy per visited chat. Switching chats changes which hierarchy is
 * projected and visible; it never unmounts another chat's native editor or file view, and a
 * hidden chat can never own the activation slot or steal focus from the one on screen.
 */
export function WorkspacePreviewProvider({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  const { selectedId } = useChatStore();
  const office = useWorkspaceOffice();
  const { activate, accountId } = office;
  const scope = useRef({ selectedId, active });
  useLayoutEffect(() => {
    scope.current = { selectedId, active };
  }, [selectedId, active]);
  const [views, publishViews] = useState<WorkspaceViews>({});
  const viewsRef = useRef<WorkspaceViews>({});
  // Admission owns pending and committed views. React receives a snapshot, never an updater
  // that reads mutable claims and may be eagerly evaluated or replayed later.
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
  const claims = useRef(new Set<string>());
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
  useLayoutEffect(() => {
    activate(
      selectedId,
      active && (activeTab.kind === "office" || activeTab.kind === "office-file")
        ? activeTab.id
        : null,
    );
    return () => activate(null, null);
  }, [active, activeTab.id, activeTab.kind, activate, selectedId]);
  const reserved = useCallback(() => claims.current.size, []);
  const readViews = useCallback(() => viewsRef.current, []);
  const openReads = useChatOpenReads();
  const actions = useWorkspacePreviewActions({
    scope,
    setViews,
    activeId: projected.activeId,
    readViews,
    reserved,
    report: office.report,
    leave: office.leave,
    cancelFiles: openReads.cancelFiles,
  });
  const claimNativeRestore = useCallback((chatId: string, tabId: string) => {
    const key = panelKey(chatId, tabId);
    if (claims.current.has(key)) return true;
    if (nativeSurfaceCount(viewsRef.current) + claims.current.size >= MAX_NATIVE_SURFACES)
      return false;
    claims.current.add(key);
    return true;
  }, []);
  const releaseNativeRestore = useCallback((chatId: string, tabId: string) => {
    claims.current.delete(panelKey(chatId, tabId));
  }, []);
  const openRead = useCallback(
    (chatId: string) => openReads.reads[chatId] ?? null,
    [openReads.reads],
  );
  /** Resolution reports the target an attachment tab now shows; the tab set stays authoritative. */
  const resolveOffice = useCallback(
    (id: string, chatId: string, selection: OfficeSelection) => {
      setViews((current) =>
        updateView(current, chatId, (view) => resolveOfficePreview(view, id, chatId, selection)),
      );
    },
    [setViews],
  );
  const restoreTab = useCallback(
    (chatId: string, captured: WorkspacePreviewTab, tab: WorkspacePreviewTab) => {
      // Convert the claim into a counted surface in the same synchronous ownership turn.
      setViews((current) => {
        const next = updateView(current, chatId, (view) => ({
          ...view,
          tabs: view.tabs.map((value) => (value === captured ? tab : value)),
        }));
        claims.current.delete(panelKey(chatId, captured.id));
        return next;
      });
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
        claimNativeRestore,
        releaseNativeRestore,
        resolveOffice,
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
