import type { SavedFile } from "@/lib/chat-library-types";
import type { TabDescriptor } from "./workspace-session";

export type WorkspaceImageFile = SavedFile;
export type WorkspacePreviewTab =
  | { id: string; kind: "restoring"; descriptor: TabDescriptor }
  | { id: string; kind: "tools" | "files" }
  | { id: string; kind: "image" | "text"; file: WorkspaceImageFile };
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
      ...current,
      tabs: [{ id: replacement, kind: "tools" }],
      activeId: replacement,
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
/** The one placeholder an explicit attachment open may allocate. */
export const attachmentTab = (file: WorkspaceImageFile): WorkspacePreviewTab => ({
  id: `workspace-image-${file.id}`,
  kind: file.kind === "image" ? "image" : "text",
  file,
});
/** The tab already representing this attachment. */
export const attachmentOwner = (
  tabs: readonly WorkspacePreviewTab[],
  fileId: string,
): WorkspacePreviewTab | null =>
  tabs.find((tab) => (tab.kind === "image" || tab.kind === "text") && tab.file.id === fileId) ??
  tabs.find(
    (tab) =>
      tab.kind === "restoring" && "fileId" in tab.descriptor && tab.descriptor.fileId === fileId,
  ) ??
  null;
