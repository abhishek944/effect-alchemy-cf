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
import type { SavedFile } from "@/lib/chat-library-types";

export type WorkspaceImageFile = SavedFile;
export type WorkspacePreviewTab =
  | { id: string; kind: "tools" | "files" }
  | { id: string; kind: "image"; file: WorkspaceImageFile };
type View = {
  chatId: string | null;
  tabs: WorkspacePreviewTab[];
  activeId: string;
  focus: { sequence: number; target: "tab" | "tools" };
};
const initial = (chatId: string | null, id: string): View => ({
  chatId,
  tabs: [{ id, kind: "tools" }],
  activeId: id,
  focus: { sequence: 0, target: "tab" },
});
type PreviewContext = View & {
  active: WorkspacePreviewTab;
  select: (id: string) => void;
  close: (id: string) => void;
  add: () => void;
  showFiles: () => void;
  openImage: (file: WorkspaceImageFile) => void;
  registerReveal: (reveal: () => void) => () => void;
};
const Context = createContext<PreviewContext | null>(null);

/** Viewing state only. Switching chats never remounts the draft-owning subtree. */
export function WorkspacePreviewProvider({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  const { selectedId } = useChatStore();
  const scope = useRef({ selectedId, active });
  useLayoutEffect(() => {
    scope.current = { selectedId, active };
  }, [selectedId, active]);
  const serial = useRef(0);
  const reveal = useRef<(() => void) | null>(null);
  const [view, setView] = useState(() => initial(selectedId, "workspace-tab-0"));
  if (view.chatId !== selectedId) setView(initial(selectedId, "workspace-tab-0"));
  const nextId = () => `workspace-tab-${++serial.current}`;
  const registerReveal = useCallback((callback: () => void) => {
    reveal.current = callback;
    return () => {
      if (reveal.current === callback) reveal.current = null;
    };
  }, []);
  const select = useCallback((id: string) => {
    setView((current) =>
      current.tabs.some((tab) => tab.id === id)
        ? {
            ...current,
            activeId: id,
            focus: { sequence: current.focus.sequence + 1, target: "tab" },
          }
        : current,
    );
  }, []);
  const add = () => {
    const id = nextId();
    setView((current) => ({
      ...current,
      tabs: [...current.tabs, { id, kind: "tools" }],
      activeId: id,
      focus: { sequence: current.focus.sequence + 1, target: "tab" },
    }));
    reveal.current?.();
  };
  const close = (id: string) => {
    const replacement = nextId();
    setView((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return current;
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      if (tabs.length === 0)
        return {
          ...initial(current.chatId, replacement),
          focus: { sequence: current.focus.sequence + 1, target: "tools" },
        };
      if (current.activeId !== id)
        return { ...current, tabs, focus: { sequence: current.focus.sequence + 1, target: "tab" } };
      const adjacent = tabs[Math.min(index, tabs.length - 1)];
      if (!adjacent) return current;
      return {
        ...current,
        tabs,
        activeId: adjacent.id,
        focus: { sequence: current.focus.sequence + 1, target: "tab" },
      };
    });
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
  const openImage = (file: WorkspaceImageFile) => {
    if (!scope.current.active || file.kind !== "image" || file.chatId !== scope.current.selectedId)
      return;
    const id = `workspace-image-${file.id}`;
    setView((current) => {
      if (current.chatId !== file.chatId) return current;
      return {
        ...current,
        activeId: id,
        tabs: current.tabs.some((tab) => tab.id === id)
          ? current.tabs
          : [...current.tabs, { id, kind: "image", file }],
        focus: { sequence: current.focus.sequence + 1, target: "tab" },
      };
    });
    reveal.current?.();
  };
  const activeTab = view.tabs.find((tab) => tab.id === view.activeId);
  if (!activeTab) throw new Error("The workspace tab selection is inconsistent.");
  const value: PreviewContext = {
    ...view,
    active: activeTab,
    select,
    close,
    add,
    showFiles,
    openImage,
    registerReveal,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspacePreview(): PreviewContext {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace previews require their workspace provider.");
  return value;
}
