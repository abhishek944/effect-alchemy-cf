import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useWorkspacePreviewOpen } from "./use-workspace-preview-open";
import {
  activatePreview,
  closePreview,
  initialPreview,
  resolveOfficePreview,
} from "./workspace-preview-model";
import type {
  OfficeSelection,
  PreviewView,
  WorkspaceImageFile,
  WorkspacePreviewTab,
} from "./workspace-preview-model";
export type { WorkspaceImageFile, WorkspacePreviewTab } from "./workspace-preview-model";

type PreviewContext = PreviewView & {
  active: WorkspacePreviewTab;
  select: (id: string) => void;
  close: (id: string) => void;
  add: () => void;
  showFiles: () => void;
  openImage: (file: WorkspaceImageFile) => void;
  openOffice: (selection: OfficeSelection) => void;
  resolveOffice: (id: string, chatId: string, selection: OfficeSelection) => void;
  registerReveal: (reveal: () => void) => () => void;
};
const Context = createContext<PreviewContext | null>(null);

/** One existing tab hierarchy. Real Office saves gate every destructive UI transition. */
export function WorkspacePreviewProvider({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  const { selectedId } = useChatStore();
  const office = useWorkspaceOffice();
  const { activate } = office;
  const scope = useRef({ selectedId, active });
  useLayoutEffect(() => {
    scope.current = { selectedId, active };
  }, [selectedId, active]);
  const serial = useRef(0);
  const reveal = useRef<(() => void) | null>(null);
  const [view, setView] = useState(() => initialPreview(selectedId, "workspace-tab-0"));
  if (view.chatId !== selectedId) setView(initialPreview(selectedId, "workspace-tab-0"));
  const activeTab = view.tabs.find((tab) => tab.id === view.activeId);
  if (activeTab === undefined) throw new Error("The workspace tab selection is inconsistent.");
  useLayoutEffect(() => {
    activate(
      active && (activeTab.kind === "office" || activeTab.kind === "office-file")
        ? activeTab.id
        : null,
    );
    return () => activate(null);
  }, [active, activeTab.id, activeTab.kind, activate]);
  const nextId = () => `workspace-tab-${++serial.current}`;
  const registerReveal = useCallback((callback: () => void) => {
    reveal.current = callback;
    return () => {
      if (reveal.current === callback) reveal.current = null;
    };
  }, []);
  // Tab focus and re-click are not destructive: retained editors keep their sessions.
  const select = (id: string) => {
    if (id === view.activeId) return;
    setView((current) => {
      const tab = current.tabs.find((value) => value.id === id);
      return tab === undefined ? current : activatePreview(current, tab);
    });
  };
  /** New native surfaces enter the same synchronous command gate as close and navigation. */
  const allocate = (action: () => void): boolean => {
    const release = office.beginCommand();
    if (release === null) {
      office.report("Finishing an Office save. Keep the editor open and try again.");
      return false;
    }
    try {
      action();
      return true;
    } finally {
      release();
    }
  };
  /** Closing finishes and drains only this tab's editor before its surface unmounts. */
  const close = (id: string) => {
    const captured = scope.current;
    void office.leave(id).then((allowed) => {
      if (!allowed || scope.current !== captured) return undefined;
      const replacement = nextId();
      setView((current) => closePreview(current, id, replacement));
      return undefined;
    });
  };
  const add = () => {
    const id = nextId();
    setView((current) => activatePreview(current, { id, kind: "tools" }));
    reveal.current?.();
  };
  const showFiles = () => {
    setView((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeId ? { id: tab.id, kind: "files" } : tab,
      ),
      focus: { sequence: current.focus.sequence + 1, target: "tab" },
    }));
    reveal.current?.();
  };
  const { openImage, openOffice } = useWorkspacePreviewOpen({
    scope,
    view,
    setView,
    allocate,
    report: office.report,
    reveal: () => reveal.current?.(),
  });
  /** Resolution reports the target an attachment tab now shows; the tab set stays authoritative. */
  const resolveOffice = (id: string, chatId: string, selection: OfficeSelection) => {
    setView((current) => resolveOfficePreview(current, id, chatId, selection));
  };
  return (
    <Context.Provider
      value={{
        ...view,
        active: activeTab,
        select,
        close,
        add,
        showFiles,
        openImage,
        openOffice,
        resolveOffice,
        registerReveal,
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
