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
import type { OfficeSelection, WorkspaceImageFile } from "./workspace-preview-model";
import {
  MAX_NATIVE_SURFACES,
  NATIVE_LIMIT,
  nativeSurfaceCount,
  openWithinCapacity,
  type WorkspaceViews,
} from "./workspace-preview-views";

type Scope = RefObject<{ selectedId: string | null; active: boolean }>;
type Options = {
  scope: Scope;
  setViews: Dispatch<SetStateAction<WorkspaceViews>>;
  /** Latest committed views, for pre-checks that must not use a stale render closure. */
  readViews: () => WorkspaceViews;
  /** Native slots reserved by started restorations that have not committed yet. */
  reserved: () => number;
  report: (message: string) => void;
  /** Reveals the right pane only when this exact chat is the one on screen. */
  reveal: (chatId: string) => void;
};

/**
 * Attachment and document opens in any retained chat workspace. Publication is origin-addressed:
 * the tab is added to that chat's view even when it is hidden, while only the on-screen chat may
 * reveal or focus. Activation of an existing tab is always allowed; a new native surface is admitted
 * inside the state update against the aggregate retained count, never against a stale closure.
 */
export function useWorkspacePreviewOpen({
  scope,
  setViews,
  readViews,
  reserved,
  report,
  reveal,
}: Options) {
  const publishImage = (chatId: string, file: WorkspaceImageFile, show: boolean) => {
    setViews((current) =>
      openWithinCapacity(
        current,
        chatId,
        (view) => {
          const owner = attachmentOwner(view.tabs, file.id);
          if (owner !== null) return activatePreview(view, owner);
          return activatePreview(view, attachmentTab(file, isNativeOpenFile(file)));
        },
        reserved(),
      ),
    );
    if (show) reveal(chatId);
  };
  /** Origin-addressed completion path: never gated by the currently selected chat. */
  const openImageIn = (chatId: string, file: WorkspaceImageFile, show: boolean) => {
    if (!["image", "text", "office"].includes(file.kind) || file.chatId !== chatId) return;
    const current = readViews();
    const view = current[chatId];
    if (view === undefined) return;
    const known = attachmentOwner(view.tabs, file.id) !== null;
    if (
      !known &&
      isNativeOpenFile(file) &&
      nativeSurfaceCount(current) + reserved() >= MAX_NATIVE_SURFACES
    ) {
      report(NATIVE_LIMIT);
      return;
    }
    publishImage(chatId, file, show);
  };
  const openImage = (file: WorkspaceImageFile) => {
    const chatId = scope.current.selectedId;
    if (!scope.current.active || chatId === null) return;
    openImageIn(chatId, file, true);
  };
  const openOfficeIn = (chatId: string | null, selection: OfficeSelection, show: boolean) => {
    if (chatId === null) return;
    const current = readViews();
    const view = current[chatId];
    if (view === undefined) return;
    const known = view.tabs.some((tab) => tabOfficeKey(tab) === officeTabId(selection));
    if (!known && nativeSurfaceCount(current) + reserved() >= MAX_NATIVE_SURFACES) {
      report(NATIVE_LIMIT);
      return;
    }
    setViews((state) =>
      openWithinCapacity(state, chatId, (next) => openOfficePreview(next, selection), reserved()),
    );
    if (show) reveal(chatId);
  };
  const openOffice = (selection: OfficeSelection) =>
    openOfficeIn(scope.current.selectedId, selection, true);
  return { openImage, openImageIn, openOffice, openOfficeIn };
}
