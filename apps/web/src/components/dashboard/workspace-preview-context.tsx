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
import {
  activatePreview,
  closePreview,
  initialPreview,
  officeTabId,
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
    activate(active && activeTab.kind === "office" ? activeTab.id : null);
    return () => activate(null);
  }, [active, activeTab.id, activeTab.kind, activate]);
  const nextId = () => `workspace-tab-${++serial.current}`;
  const registerReveal = useCallback((callback: () => void) => {
    reveal.current = callback;
    return () => {
      if (reveal.current === callback) reveal.current = null;
    };
  }, []);
  const change = (action: () => void) => {
    const captured = scope.current;
    void office.transition(() => {
      if (scope.current === captured) action();
    });
  };
  const select = (id: string) => {
    if (id === view.activeId) return;
    change(() =>
      setView((current) => {
        const tab = current.tabs.find((value) => value.id === id);
        return tab === undefined ? current : activatePreview(current, tab);
      }),
    );
  };
  const close = (id: string) =>
    change(() => {
      const replacement = nextId();
      setView((current) => closePreview(current, id, replacement));
    });
  const add = () =>
    change(() => {
      const id = nextId();
      setView((current) => activatePreview(current, { id, kind: "tools" }));
      reveal.current?.();
    });
  const showFiles = () =>
    change(() => {
      setView((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === current.activeId ? { id: tab.id, kind: "files" } : tab,
        ),
        focus: { sequence: current.focus.sequence + 1, target: "tab" },
      }));
      reveal.current?.();
    });
  const openImage = (file: WorkspaceImageFile) => {
    if (!scope.current.active || file.kind !== "image" || file.chatId !== scope.current.selectedId)
      return;
    change(() => {
      setView((current) =>
        current.chatId === file.chatId
          ? activatePreview(current, { id: `workspace-image-${file.id}`, kind: "image", file })
          : current,
      );
      reveal.current?.();
    });
  };
  const openOffice = (selection: OfficeSelection) => {
    if (!scope.current.active || scope.current.selectedId === null) return;
    const id = officeTabId(selection);
    if (
      !view.tabs.some((tab) => tab.id === id) &&
      view.tabs.filter((tab) => tab.kind === "office").length >= 8
    ) {
      office.report(
        "Close a saved Office tab before opening another; eight native surfaces are the browser limit.",
      );
      return;
    }
    change(() => {
      setView((current) => activatePreview(current, { id, kind: "office", selection }));
      reveal.current?.();
    });
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
