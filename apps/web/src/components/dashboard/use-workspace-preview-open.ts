import type { Dispatch, RefObject, SetStateAction } from "react";
import { isNativeOpenFile } from "@/lib/office-original";
import {
  activatePreview,
  attachmentOwner,
  attachmentTab,
  officeTabId,
  openOfficePreview,
  tabOfficeKey,
} from "./workspace-preview-model";
import type { OfficeSelection, PreviewView, WorkspaceImageFile } from "./workspace-preview-model";

type Scope = RefObject<{ selectedId: string | null; active: boolean }>;
type Options = {
  scope: Scope;
  view: PreviewView;
  setView: Dispatch<SetStateAction<PreviewView>>;
  allocate: (action: () => void) => boolean;
  report: (message: string) => void;
  reveal: () => void;
};

/**
 * Explicit attachment and document opens. A known file/target identity only focuses its
 * surviving tab; only allocating a NEW native surface enters the command gate.
 */
export function useWorkspacePreviewOpen({
  scope,
  view,
  setView,
  allocate,
  report,
  reveal,
}: Options) {
  const openImage = (file: WorkspaceImageFile) => {
    if (
      !scope.current.active ||
      !["image", "text", "office"].includes(file.kind) ||
      file.chatId !== scope.current.selectedId
    )
      return;
    // Known attachment identity focuses its surviving tab before capacity or allocation.
    if (attachmentOwner(view.tabs, file.id) !== null) {
      setView((current) => {
        if (current.chatId !== file.chatId) return current;
        const tab = attachmentOwner(current.tabs, file.id);
        return tab === null ? current : activatePreview(current, tab);
      });
      reveal();
      return;
    }
    const native = isNativeOpenFile(file);
    if (
      native &&
      view.tabs.filter((tab) => tab.kind === "office" || tab.kind === "office-file").length >= 8
    ) {
      report(
        "Close a saved native tab before opening another; eight native surfaces are the browser limit.",
      );
      return;
    }
    const create = () => {
      setView((current) =>
        current.chatId === file.chatId
          ? activatePreview(current, attachmentTab(file, native))
          : current,
      );
      reveal();
    };
    if (native) allocate(create);
    else create();
  };
  const openOffice = (selection: OfficeSelection) => {
    if (!scope.current.active || scope.current.selectedId === null) return;
    const known = view.tabs.some((tab) => tabOfficeKey(tab) === officeTabId(selection));
    if (
      !known &&
      view.tabs.filter((tab) => tab.kind === "office" || tab.kind === "office-file").length >= 8
    ) {
      report(
        "Close a saved native tab before opening another; eight native surfaces are the browser limit.",
      );
      return;
    }
    const open = () => {
      setView((current) =>
        current.chatId === scope.current.selectedId
          ? openOfficePreview(current, selection)
          : current,
      );
      reveal();
    };
    if (known) open();
    else allocate(open);
  };
  return { openImage, openOffice };
}
