import type { SavedFile } from "@/lib/chat-library-types";
import type { Target } from "@starter/office-contract";

export type OfficeSelection = { title: string; target: Target; reviewId: string | null };
export type WorkspaceImageFile = SavedFile;
export type WorkspacePreviewTab =
  | { id: string; kind: "tools" | "files" }
  | { id: string; kind: "image" | "text"; file: WorkspaceImageFile }
  | {
      id: string;
      kind: "office-file";
      file: WorkspaceImageFile;
      resolved: OfficeSelection | null;
      attachments: readonly string[];
    }
  | {
      id: string;
      kind: "office";
      selection: OfficeSelection;
      attachments: readonly string[];
    };
type NativeTab = Extract<WorkspacePreviewTab, { kind: "office" | "office-file" }>;
type AttachmentTab = Extract<WorkspacePreviewTab, { kind: "office-file" }>;
const isNativeTab = (tab: WorkspacePreviewTab): tab is NativeTab =>
  tab.kind === "office" || tab.kind === "office-file";
/** Known attachment identities stay on the native tab that survived convergence. */
const withAttachment = (tab: WorkspacePreviewTab, fileId: string): WorkspacePreviewTab =>
  isNativeTab(tab) && !tab.attachments.includes(fileId)
    ? { ...tab, attachments: [...tab.attachments, fileId] }
    : tab;
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
export const officeTabId = (selection: OfficeSelection): string => {
  const { target, reviewId } = selection;
  return `workspace-office-${target.documentId}-${reviewId ?? (target.scope.kind === "main" ? "main" : `${target.scope.draftId}-${target.scope.generation}`)}`;
};
/** The exact document/draft/generation (or immutable review) this tab currently shows. */
export const tabOfficeKey = (tab: WorkspacePreviewTab): string | null =>
  tab.kind === "office"
    ? officeTabId(tab.selection)
    : tab.kind === "office-file" && tab.resolved !== null
      ? officeTabId(tab.resolved)
      : null;
/** The one placeholder an explicit attachment open may allocate. */
export const attachmentTab = (file: WorkspaceImageFile, native: boolean): WorkspacePreviewTab =>
  native
    ? {
        id: `workspace-file-${file.id}`,
        kind: "office-file",
        file,
        resolved: null,
        attachments: [file.id],
      }
    : { id: `workspace-image-${file.id}`, kind: file.kind === "image" ? "image" : "text", file };
/** The tab already representing this attachment, including a resolved alias. */
export const attachmentOwner = (
  tabs: readonly WorkspacePreviewTab[],
  fileId: string,
): WorkspacePreviewTab | null =>
  tabs.find(
    (tab) =>
      (tab.kind === "image" || tab.kind === "text" || tab.kind === "office-file") &&
      tab.file.id === fileId,
  ) ??
  tabs.find((tab) => isNativeTab(tab) && tab.attachments.includes(fileId)) ??
  null;
/** Activate the one tab that already shows this target; only add a tab when none does. */
export function openOfficePreview(current: PreviewView, selection: OfficeSelection): PreviewView {
  const key = officeTabId(selection);
  const existing = current.tabs.find((tab) => tabOfficeKey(tab) === key);
  return activatePreview(
    current,
    existing ?? { id: key, kind: "office", selection, attachments: [] },
  );
}
/**
 * An attachment tab becomes the target's tab once its original resolves. If another tab
 * already shows that exact target, the attachment tab is dropped instead of mounting a
 * second native surface, and the owner stays selected.
 */
export function resolveOfficePreview(
  current: PreviewView,
  id: string,
  chatId: string,
  selection: OfficeSelection,
): PreviewView {
  if (current.chatId !== chatId) return current;
  const own = current.tabs.find(
    (tab): tab is AttachmentTab => tab.id === id && tab.kind === "office-file",
  );
  if (own === undefined) return current;
  // A stale resolution never pulls focus back from the tab the user chose meanwhile.
  const showing = current.activeId === id;
  const key = officeTabId(selection);
  const owner = current.tabs.find((tab) => tab.id !== id && tabOfficeKey(tab) === key);
  if (owner !== undefined) {
    // Keep the attachment identity on the surviving tab so its next open focuses it.
    const tabs = current.tabs
      .filter((tab) => tab.id !== id)
      .map((tab) => (tab.id === owner.id ? withAttachment(tab, own.file.id) : tab));
    return {
      ...current,
      tabs,
      activeId: showing ? owner.id : current.activeId,
      focus: showing ? { sequence: current.focus.sequence + 1, target: "tab" } : current.focus,
    };
  }
  const tabs = current.tabs.map((tab) =>
    tab.id === id && tab.kind === "office-file"
      ? withAttachment({ ...tab, resolved: selection }, tab.file.id)
      : tab,
  );
  return showing
    ? { ...current, tabs, focus: { sequence: current.focus.sequence + 1, target: "tab" } }
    : { ...current, tabs };
}
