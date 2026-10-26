import { useCallback } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspacePreview } from "./workspace-preview-context";

/**
 * Explicit saved-file open status for one origin chat. The request itself is owned by the preview
 * provider, so unmounting a message row or conversation does not cancel it; this hook only starts
 * a visible intent and projects that chat's latest read state.
 */
export function useChatLibraryOpen({
  active = true,
  chatId,
}: {
  active?: boolean;
  /** Omit to use the chat currently shown by the facade. */
  chatId?: string | null;
} = {}) {
  const { selectedId } = useChatStore();
  const preview = useWorkspacePreview();
  const origin = chatId === undefined ? selectedId : chatId;
  const read = origin === null ? null : preview.openRead(origin);
  const open = useCallback(
    async (fileId: string): Promise<void> => {
      if (!active || origin === null) return;
      // The completion publishes into the captured origin, never the chat visible later.
      preview.openSavedFile(origin, fileId, true);
    },
    [active, origin, preview],
  );
  return {
    open,
    state: read?.state ?? "idle",
    error: read?.error ?? null,
    fileId: read?.fileId ?? null,
    retry: () => (read === null ? Promise.resolve() : open(read.fileId)),
    dismiss: () => {
      if (origin !== null && read !== null) preview.dismissOpen(origin, read);
    },
  };
}

export type ChatLibraryOpen = ReturnType<typeof useChatLibraryOpen>;
