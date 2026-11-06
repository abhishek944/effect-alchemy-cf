import type { Dispatch, RefObject, SetStateAction } from "react";
import { isNativeOpenFile } from "@/lib/office-original";
import {
  activatePreview,
  attachmentOwner,
  attachmentTab,
  openOfficePreview,
} from "./workspace-preview-model";
import type { OfficeSelection, WorkspaceImageFile } from "./workspace-preview-model";
import { updateView, type WorkspaceViews } from "./workspace-preview-views";

type Scope = RefObject<{ selectedId: string | null; active: boolean }>;
type Options = {
  scope: Scope;
  setViews: Dispatch<SetStateAction<WorkspaceViews>>;
  readViews: () => WorkspaceViews;
  /** Reveals the right pane only when this exact chat is the one on screen. */
  reveal: (chatId: string) => void;
};

/**
 * Attachment and document opens in any retained chat workspace. Publication is origin-addressed:
 * the tab is added to that chat's view even when it is hidden, while only the on-screen chat may
 * reveal or focus. State updates preserve all existing mounted views and origin identity.
 */
export function useWorkspacePreviewOpen({ scope, setViews, readViews, reveal }: Options) {
  const publishImage = (chatId: string, file: WorkspaceImageFile, show: boolean) => {
    setViews((current) =>
      updateView(current, chatId, (view) => {
        const owner = attachmentOwner(view.tabs, file.id);
        if (owner !== null) return activatePreview(view, owner);
        return activatePreview(view, attachmentTab(file, isNativeOpenFile(file)));
      }),
    );
    if (show) reveal(chatId);
  };
  /** Origin-addressed completion path: never gated by the currently selected chat. */
  const openImageIn = (chatId: string, file: WorkspaceImageFile, show: boolean) => {
    if (!["image", "text", "office"].includes(file.kind) || file.chatId !== chatId) return;
    if (readViews()[chatId] === undefined) return;
    publishImage(chatId, file, show);
  };
  const openImage = (file: WorkspaceImageFile) => {
    const chatId = scope.current.selectedId;
    if (!scope.current.active || chatId === null) return;
    openImageIn(chatId, file, true);
  };
  const openOfficeIn = (chatId: string | null, selection: OfficeSelection, show: boolean) => {
    if (chatId === null || readViews()[chatId] === undefined) return;
    setViews((state) => updateView(state, chatId, (next) => openOfficePreview(next, selection)));
    if (show) reveal(chatId);
  };
  const openOffice = (selection: OfficeSelection) =>
    openOfficeIn(scope.current.selectedId, selection, true);
  return { openImage, openImageIn, openOffice, openOfficeIn };
}
