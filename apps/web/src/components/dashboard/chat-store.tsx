import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChatSnapshot } from "@/lib/chat-api";
import { chatPath, chatIdFromPath, isChatLanding } from "@/lib/chat-route";
import { navigate } from "@/lib/router";
import { useChatSelection } from "./use-chat-selection";
import {
  ChatStoreContext,
  type ChatActionError,
  type ChatStoreValue,
} from "@/lib/chat-store-context";
import { useChatCatalog } from "./use-chat-catalog";
import { useChatFiles } from "./use-chat-files";
import { useChatPreferences } from "./use-chat-preferences";
import { useChatStoreUsage } from "./use-chat-store-usage";
import { useChatReferenceDrafts } from "./use-chat-reference-drafts";
import { ChatSessionOwner } from "./chat-session-owner";
import { useChatSessionRegistry } from "./use-chat-session-registry";
import { newestChat } from "./chat-session-types";
const HIDDEN = { selection: null, selectionReady: false, referencesBlocked: null };

/**
 * Selected-view facade over retained per-chat owners. Catalog, staged files, references, model
 * preferences and usage stay single account-scoped owners; the work that must outlive visibility
 * (stream, pending Send, Stop, receipts, uploads) lives in one owner per chat.
 */
export default function ChatStoreProvider({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  const { selectedId, select: selectRoute } = useChatSelection(pathname);
  const [catalogActionError, reportCatalogError] = useState<ChatActionError | null>(null);
  const sessions = useChatSessionRegistry(selectedId);
  const select = useCallback(
    (id: string | null) => {
      selectRoute(id);
      reportCatalogError(null);
    },
    [selectRoute],
  );
  const { chats, listState, listError, creating, overrides, refreshList, startNewChat, patchChat } =
    useChatCatalog({ onSelect: select, setActionError: reportCatalogError });
  useEffect(() => {
    // A late catalog result must never replace an explicit chat or Settings URL.
    if (creating || pathname !== window.location.pathname || !isChatLanding(pathname)) return;
    const id = selectedId ?? chats[0]?.id;
    if (id) navigate(chatPath(id), { replace: true });
  }, [chats, creating, pathname, selectedId]);
  const staged = useChatFiles(selectedId);
  const preferences = useChatPreferences(selectedId);
  const selected = sessions.selected;
  const pendingSend = selected?.state.pendingSend ?? null;
  const attachment = selected?.state.attachment ?? `${selectedId ?? "none"}:0`;
  const override = selectedId === null ? undefined : overrides[selectedId];
  const snapshot = useMemo<ChatSnapshot | null>(() => {
    const live = selected?.state.snapshot ?? null;
    if (!live) return null;
    const chat = newestChat(live.chat, override);
    return chat === null || chat === live.chat ? live : { ...live, chat };
  }, [override, selected]);
  // This address remains valid even after its stream owner has been released.
  const reportChatError = sessions.reportError;
  const selectedIdAtRender = selectedId;
  const draftReferences = useChatReferenceDrafts({
    chatId: selectedId,
    scope: attachment,
    active:
      selectedId !== null && (chatIdFromPath(pathname) === selectedId || isChatLanding(pathname)),
    archived: chats.find((chat) => chat.id === selectedId)?.archived ?? true,
    lockedIds:
      pendingSend !== null && pendingSend.phase !== "accepted"
        ? (pendingSend.frozen?.references ?? [])
        : [],
    staged: staged.files,
    model: preferences.entry,
    reportError: (message) => reportChatError(selectedIdAtRender, message),
  });
  const references = draftReferences.references;
  const usage = useChatStoreUsage(selectedId, snapshot, attachment, preferences);
  const renameChat = useCallback(
    (id: string, title: string) => patchChat(id, { title }),
    [patchChat],
  );
  const setArchived = useCallback(
    (id: string, archived: boolean) => patchChat(id, { archived }),
    [patchChat],
  );
  const value: ChatStoreValue = {
    chats,
    listState,
    listError,
    selectedId,
    snapshot,
    connection: selected?.state.connection ?? (selectedId ? "connecting" : "idle"),
    connectionError: selected?.state.connectionError ?? null,
    actionError: sessions.error(selectedId),
    pendingSend,
    stopping: selected?.state.stopping ?? null,
    attachment,
    creating,
    preferences,
    stagedFiles: staged,
    references,
    usage,
    runningChatIds: sessions.runningChatIds,
    panelRequests: sessions.panelRequests,
    claimPanelRequest: sessions.claimPanelRequest,
    select,
    startNewChat,
    renameChat,
    setArchived,
    send: sessions.send,
    retrySend: sessions.retrySend,
    discardSend: sessions.discardSend,
    stop: sessions.stop,
    acknowledgeOperations: sessions.acknowledgeOperations,
    reportError: (message) => reportChatError(selectedId, message),
    reportChatError,
    catalogActionError,
    reportCatalogError,
    reload: sessions.reload,
    reloadList: refreshList,
  };
  return (
    <ChatStoreContext.Provider value={value}>
      {sessions.ownerIds.map((chatId) => (
        <ChatSessionOwner
          key={`${chatId}:${sessions.epoch(chatId)}`}
          chatId={chatId}
          active={chatId === selectedId}
          override={overrides[chatId]}
          controlsFor={staged.controlsFor}
          admission={
            chatId === selectedId
              ? {
                  selection: preferences.selection,
                  selectionReady: preferences.selectionReady,
                  referencesBlocked: references.blockedReason,
                }
              : HIDDEN
          }
          refreshList={refreshList}
          reportError={reportChatError}
          publish={sessions.publish}
          remove={sessions.remove}
        />
      ))}
      {children}
    </ChatStoreContext.Provider>
  );
}
