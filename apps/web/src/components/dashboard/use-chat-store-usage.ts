import { useCallback, useMemo } from "react";
import type { ChatSnapshot } from "@/lib/chat-api";
import type { ChatSelectionControls } from "@/lib/chat-store-context";
import { useChatUsage } from "./use-chat-usage";

/** Usage and model-mismatch recovery stay together, outside store composition. */
export function useChatStoreUsage(
  chatId: string | null,
  snapshot: ChatSnapshot | null,
  attachment: string,
  preferences: ChatSelectionControls,
) {
  const state = useChatUsage(
    chatId,
    Boolean(snapshot?.isRunning),
    attachment,
    preferences.selection?.model ?? null,
    snapshot?.usageRevision ?? null,
    snapshot?.history.ceilingEntryId ?? null,
  );
  const retryPreferences = preferences.retry;
  const reloadUsage = state.reload;
  const reconcile = useCallback(() => {
    reloadUsage();
    retryPreferences();
  }, [reloadUsage, retryPreferences]);
  return useMemo(() => ({ ...state, reconcile }), [state, reconcile]);
}
