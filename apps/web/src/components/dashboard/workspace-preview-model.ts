import type { SavedFile } from "@/lib/chat-library-types";
import type { Target } from "@starter/office-contract";
import type { TabDescriptor } from "./workspace-session";

export type OfficeSelection = {
  title: string;
  target: Target;
  reviewId: string | null;
  /** Known opened attachment identities for this shown target; never guessed from documentId. */
  attachments: readonly string[];
};
export type WorkspaceImageFile = SavedFile;
export type WorkspacePreviewTab =
  | { id: string; kind: "restoring"; descriptor: TabDescriptor }
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
const isNativeTab = (tab: WorkspacePreviewTab): tab is NativeTab =>
  tab.kind === "office" || tab.kind === "office-file";
/** Known attachment identities stay on the native tab and on the selection that survived convergence. */
const withAttachment = (tab: WorkspacePreviewTab, fileId: string): WorkspacePreviewTab => {
  if (tab.kind === "restoring" && tab.descriptor.kind === "office") {
    const descriptor = tab.descriptor;
    return descriptor.attachments.includes(fileId)
      ? tab
      : { ...tab, descriptor: { ...descriptor, attachments: [...descriptor.attachments, fileId] } };
  }
  if (!isNativeTab(tab) || tab.attachments.includes(fileId)) return tab;
  const attachments = [...tab.attachments, fileId];
  if (tab.kind === "office")
    return { ...tab, attachments, selection: { ...tab.selection, attachments } };
  return tab.resolved === null
    ? { ...tab, attachments }
    : { ...tab, attachments, resolved: { ...tab.resolved, attachments } };
};
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
      : tab.kind === "restoring" && tab.descriptor.kind === "office"
        ? officeTabId({ ...tab.descriptor, title: "Saved document" })
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
  tabs.find(
    (tab) =>
      tab.kind === "restoring" &&
      (tab.descriptor.kind === "office"
        ? tab.descriptor.attachments.includes(fileId)
        : "fileId" in tab.descriptor && tab.descriptor.fileId === fileId),
  ) ??
  null;
/** Activate the one tab that already shows this target; only add a tab when none does. */
export function openOfficePreview(current: PreviewView, selection: OfficeSelection): PreviewView {
  const key = officeTabId(selection);
  const existing = current.tabs.find((tab) => tabOfficeKey(tab) === key);
  const base: WorkspacePreviewTab = existing ?? {
    id: key,
    kind: "office",
    selection,
    attachments: [],
  };
  return activatePreview(current, selection.attachments.reduce(withAttachment, base));
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
  const own = current.tabs.find((tab): tab is NativeTab => tab.id === id && isNativeTab(tab));
  if (own === undefined) return current;
  // A stale resolution never pulls focus back from the tab the user chose meanwhile.
  const showing = current.activeId === id;
  const key = officeTabId(selection);
  const sameTarget = tabOfficeKey(own) === key;
  const currentSelection = own.kind === "office" ? own.selection : own.resolved;
  if (
    sameTarget &&
    currentSelection?.title === selection.title &&
    selection.attachments.every((attachment) => own.attachments.includes(attachment))
  )
    return current;
  const owner = current.tabs.find((tab) => tab.id !== id && tabOfficeKey(tab) === key);
  if (owner !== undefined) {
    // Keep the attachment identity on the surviving tab so its next open focuses it.
    const tabs = current.tabs
      .filter((tab) => tab.id !== id)
      .map((tab) => {
        if (tab.id !== owner.id) return tab;
        const joined = own.attachments.reduce(withAttachment, tab);
        return joined.kind === "office" && joined.selection.title === "Office document"
          ? { ...joined, selection: { ...joined.selection, title: selection.title } }
          : joined;
      });
    return {
      ...current,
      tabs,
      activeId: showing ? owner.id : current.activeId,
      focus: showing ? { sequence: current.focus.sequence + 1, target: "tab" } : current.focus,
    };
  }
  const tabs = current.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    const attachments = [...new Set([...own.attachments, ...selection.attachments])];
    return own.kind === "office"
      ? { ...own, selection: { ...selection, attachments }, attachments }
      : { ...own, resolved: { ...selection, attachments }, attachments };
  });
  return showing && !sameTarget
    ? { ...current, tabs, focus: { sequence: current.focus.sequence + 1, target: "tab" } }
    : { ...current, tabs };
}
