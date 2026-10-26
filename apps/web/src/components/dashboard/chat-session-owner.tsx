import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { Chat, ChatSnapshot } from "@/lib/chat-api";
import type { ChatSelection as ChatModelSelection } from "@/lib/chat-capability-types";
import type { ChatFilesControls, PendingSend } from "@/lib/chat-store-context";
import type { ChatReferences } from "./use-chat-references";
import { useChatStream } from "./use-chat-stream";
import { useChatMetadataRefresh } from "./use-chat-metadata-refresh";
import { useChatStop } from "./use-chat-stop";
import { useChatSend } from "./use-chat-send";
import { useOperationReceipt } from "./use-operation-receipt";
import { useSendAcceptance } from "./use-send-acceptance";
import {
  newestChat,
  type ChatSessionApi,
  type ChatSessionEntry,
  type ChatSessionState,
} from "./chat-session-types";

type Admission = {
  selection: ChatModelSelection | null;
  selectionReady: boolean;
  /** Same admission reason the visible composer shows for saved references plus uploads. */
  referencesBlocked: string | null;
};
type Props = {
  chatId: string;
  active: boolean;
  /** Newest catalog metadata for this chat, merged only for admission and receipt text. */
  override: Chat | undefined;
  /** This chat's staged-row operations; read at Send/discard time, never captured. */
  controlsFor: (chatId: string) => ChatFilesControls;
  admission: Admission;
  refreshList: () => void;
  reportError: (chatId: string, update: SetStateAction<string | null>) => void;
  publish: (chatId: string, entry: ChatSessionEntry, visible: boolean) => void;
  remove: (chatId: string, owner: object) => void;
};
const NO_IDS: string[] = [];
const NO_COMMIT = () => undefined;

/**
 * One chat's retained work owner. It renders nothing: its stream, pending Send, Stop, receipt
 * resolution and metadata refresh keep running while another chat is visible, and every action is
 * bound to this chat id. Unmounting is the only release, and it always re-reads on return.
 */
export function ChatSessionOwner({
  chatId,
  active,
  override,
  controlsFor,
  admission,
  refreshList,
  reportError,
  publish,
  remove,
}: Props) {
  const [owner] = useState(() => ({}));
  // A unique fence per mount: a returned-to chat and a manual reload never share history keys.
  const [attachment] = useState(() => `${chatId}:${crypto.randomUUID()}`);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const setActionError = useCallback(
    (update: SetStateAction<string | null>) => reportError(chatId, update),
    [chatId, reportError],
  );
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  // Saved-reference identities are atomic composer nodes today; only their admission reason can
  // block this store-level path, and it is the selected chat's exact composer reason.
  const references = useMemo<ChatReferences>(
    () => ({
      files: [],
      ids: NO_IDS,
      add: () => false,
      remove: () => undefined,
      retry: async () => undefined,
      readFor: (file) => ({
        state: file.state === "ready" ? "ready" : "error",
        error: file.state === "ready" ? null : "Original unavailable",
      }),
      markUnavailable: () => undefined,
      blockedReason: admission.referencesBlocked,
    }),
    [admission.referencesBlocked],
  );
  // Read at Send/discard time through the account-wide staging map; never a captured snapshot.
  const readFiles = () => controlsFor(chatId);
  const commitFiles = (targetChatId: string, ids: readonly string[]) =>
    readFiles().commit(targetChatId, ids);
  const { acceptFiles, onAccepted, settle, acknowledgeOperations } = useSendAcceptance(
    pendingSend,
    commitFiles,
    NO_COMMIT,
    setPendingSend,
  );
  const stream = useChatStream(chatId, attachment, settle);
  // The same newest-authoritative merge the facade uses; never another chat's projection.
  const chat = newestChat(stream.snapshot?.chat ?? null, override);
  useChatMetadataRefresh(stream.snapshot, refreshList);
  useLayoutEffect(() => {
    snapshotRef.current = stream.snapshot;
  }, [stream.snapshot]);
  useOperationReceipt({
    pendingSend,
    snapshot: stream.snapshot,
    selectedId: chatId,
    attachment,
    chatTitle: chat?.title ?? "this chat",
    setPendingSend,
    setActionError,
    onAccepted,
  });
  const { stop, stopping, stoppingRef } = useChatStop(setActionError);
  const { send, retrySend, discardSend, sending } = useChatSend({
    chatId,
    pendingSend,
    connection: stream.connection,
    snapshotRef,
    stoppingRef,
    selection: admission.selection,
    selectionReady: admission.selectionReady,
    archived: chat?.archived ?? true,
    readFiles,
    references,
    acceptFiles,
    refreshList,
    setActionError,
    setPendingSend,
  });
  const state = useMemo<ChatSessionState>(
    () => ({
      chatId,
      snapshot: stream.snapshot,
      connection: stream.connection,
      connectionError: stream.connectionError,
      pendingSend,
      stopping,
      sending,
      attachment,
    }),
    [
      chatId,
      stream.snapshot,
      stream.connection,
      stream.connectionError,
      pendingSend,
      stopping,
      sending,
      attachment,
    ],
  );
  const api: ChatSessionApi = {
    send: (text, referenceInputs) => send(text, chatId, referenceInputs),
    retrySend,
    discardSend,
    stop,
    acknowledge: (operationIds) => acknowledgeOperations(chatId, operationIds),
  };
  const latest = useRef<ChatSessionEntry>({ owner, state, api });
  const visible = useRef(active);
  useLayoutEffect(() => {
    latest.current = { owner, state, api };
    visible.current = active;
    publish(chatId, latest.current, active);
  });
  // StrictMode replays mount effects: re-publish on setup so the replay cannot leave us absent.
  useEffect(() => {
    publish(chatId, latest.current, visible.current);
    return () => remove(chatId, owner);
  }, [chatId, owner, publish, remove]);
  return null;
}
