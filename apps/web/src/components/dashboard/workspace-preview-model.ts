import type { SavedFile } from "@/lib/chat-library-types";
import type { Target } from "@starter/office-contract";

export type OfficeSelection = { title: string; target: Target; reviewId: string | null };
export type WorkspaceImageFile = SavedFile;
export type WorkspacePreviewTab =
  | { id: string; kind: "tools" | "files" }
  | { id: string; kind: "image"; file: WorkspaceImageFile }
  | { id: string; kind: "office"; selection: OfficeSelection };
export type PreviewView = {
  chatId: string | null;
  tabs: WorkspacePreviewTab[];
  activeId: string;
  focus: { sequence: number; target: "tab" | "tools" };
};
export const initialPreview = (chatId: string | null, id: string): PreviewView => ({
  chatId,
  tabs: [{ id, kind: "tools" }],
  activeId: id,
  focus: { sequence: 0, target: "tab" },
});
export function activatePreview(current: PreviewView, tab: WorkspacePreviewTab): PreviewView {
  return {
    ...current,
    activeId: tab.id,
    tabs: current.tabs.some((value) => value.id === tab.id) ? current.tabs : [...current.tabs, tab],
    focus: { sequence: current.focus.sequence + 1, target: "tab" },
  };
}
export function closePreview(current: PreviewView, id: string, replacement: string): PreviewView {
  const index = current.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return current;
  const tabs = current.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0)
    return {
      ...initialPreview(current.chatId, replacement),
      focus: { sequence: current.focus.sequence + 1, target: "tools" },
    };
  const adjacent = tabs[Math.min(index, tabs.length - 1)];
  if (adjacent === undefined) return current;
  return {
    ...current,
    tabs,
    activeId: current.activeId === id ? adjacent.id : current.activeId,
    focus: { sequence: current.focus.sequence + 1, target: "tab" },
  };
}
export const officeTabId = (selection: OfficeSelection): string => {
  const { target, reviewId } = selection;
  return `workspace-office-${target.documentId}-${reviewId ?? (target.scope.kind === "main" ? "main" : `${target.scope.draftId}-${target.scope.generation}`)}`;
};
