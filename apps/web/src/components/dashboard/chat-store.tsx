import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Chat, ChatSnapshot } from "@/lib/chat-api";
import { chatPath, chatIdFromPath, isChatLanding } from "@/lib/chat-route";
import { navigate } from "@/lib/router";
import { useChatSelection } from "./use-chat-selection";
import { ChatStoreContext, type ChatStoreValue, type PendingSend } from "@/lib/chat-store-context";
import type { ChatActionError } from "@/lib/chat-store-context";
import { useChatCatalog } from "./use-chat-catalog";
import { useChatFiles } from "./use-chat-files";
import { useChatPreferences } from "./use-chat-preferences";
import { useChatSend } from "./use-chat-send";
import { useChatStop } from "./use-chat-stop";
import { useChatStream } from "./use-chat-stream";
import { useChatStoreUsage } from "./use-chat-store-usage";
import { useChatReferenceDrafts } from "./use-chat-reference-drafts";
import { useOperationReceipt } from "./use-operation-receipt";
import { useChatMetadataRefresh } from "./use-chat-metadata-refresh";
import { useSendAcceptance } from "./use-send-acceptance";
const atLeastAsNew = (a: Chat, b: Chat) => Date.parse(a.updatedAt) >= Date.parse(b.updatedAt);
export default function ChatStoreProvider({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  const { selectedId, generation, selectionRef, select: selectRoute } = useChatSelection(pathname);
  const [actionError, setActionError] = useState<string | null>(null);
  const [catalogActionError, reportCatalogError] = useState<ChatActionError | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  const select = useCallback(
    (id: string | null) => {
      selectRoute(id);
      setActionError(null);
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

  const preferences = useChatPreferences(selectedId);
  const stagedFiles = useChatFiles(selectedId);
  const referenceDrafts = useChatReferenceDrafts({
    chatId: selectedId,
    scope: `${generation}:${reloadKey}`,
    active:
      selectedId !== null && (chatIdFromPath(pathname) === selectedId || isChatLanding(pathname)),
    archived: chats.find((chat) => chat.id === selectedId)?.archived ?? true,
    lockedIds:
      pendingSend?.chatId === selectedId && pendingSend.phase !== "accepted"
        ? (pendingSend.frozen?.references ?? [])
        : [],
    staged: stagedFiles.files,
    model: preferences.entry,
    reportError: setActionError,
  });
  const references = referenceDrafts.references;
  const { acceptFiles, onAccepted, settle, acknowledgeOperations } = useSendAcceptance(
    pendingSend,
    stagedFiles.commit,
    referenceDrafts.commit,
    setPendingSend,
  );
  const attachment = `${generation}:${reloadKey}`;
  const {
    snapshot: liveSnapshot,
    connection,
    connectionError,
  } = useChatStream(selectedId, attachment, settle);
  useChatMetadataRefresh(liveSnapshot, refreshList);
  const usage = useChatStoreUsage(selectedId, liveSnapshot, attachment, preferences);

  /** Latest catalog rename/archive/title wins until a newer event carries metadata. */
  const snapshot = useMemo<ChatSnapshot | null>(() => {
    if (!liveSnapshot) return null;
    const override = overrides[liveSnapshot.chat.id];
    if (!override || !atLeastAsNew(override, liveSnapshot.chat)) return liveSnapshot;
    return { ...liveSnapshot, chat: override };
  }, [liveSnapshot, overrides]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useOperationReceipt({
    pendingSend,
    snapshot,
    selectedId,
    attachment,
    chatTitle: snapshot?.chat.title ?? "this chat",
    setPendingSend,
    setActionError,
    onAccepted,
  });

  const { stop, stopping, stoppingRef } = useChatStop(setActionError);
  const { send, retrySend, discardSend } = useChatSend({
    pendingSend,
    connection,
    selectionRef,
    snapshotRef,
    stoppingRef,
    selection: preferences.selection,
    selectionReady: preferences.selectionReady,
    stagedFiles,
    references,
    acceptFiles,
    refreshList,
    setActionError,
    setPendingSend,
  });

  const renameChat = useCallback(
    (id: string, title: string) => patchChat(id, { title }),
    [patchChat],
  );
  const setArchived = useCallback(
    (id: string, archived: boolean) => patchChat(id, { archived }),
    [patchChat],
  );
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  const value = useMemo<ChatStoreValue>(
    () => ({
      chats,
      listState,
      listError,
      selectedId,
      snapshot,
      connection,
      connectionError,
      actionError,
      pendingSend,
      stopping,
      attachment,
      creating,
      preferences,
      stagedFiles,
      references,
      usage,
      select,
      startNewChat,
      renameChat,
      setArchived,
      send,
      retrySend,
      discardSend,
      stop,
      acknowledgeOperations,
      reportError: setActionError,
      catalogActionError,
      reportCatalogError,
      reload,
      reloadList: refreshList,
    }),
    [
      chats,
      listState,
      listError,
      selectedId,
      snapshot,
      connection,
      connectionError,
      actionError,
      pendingSend,
      stopping,
      attachment,
      creating,
      preferences,
      stagedFiles,
      references,
      usage,
      select,
      startNewChat,
      renameChat,
      setArchived,
      send,
      retrySend,
      discardSend,
      stop,
      acknowledgeOperations,
      setActionError,
      catalogActionError,
      reload,
      refreshList,
    ],
  );

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}
