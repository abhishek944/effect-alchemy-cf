import { createContext, useContext } from "react";
import type { CapabilityLoadState } from "@/lib/chat-capability-api";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import type {
  ChatCatalog,
  ChatCatalogEntry,
  ChatEffort,
  ChatSelection,
} from "@/lib/chat-capability-types";
import type { ChatUsage } from "@/lib/chat-capability-usage-types";
import type { Chat, ChatSnapshot } from "@/lib/chat-api";
import type { LocalFile } from "@/lib/chat-file-local";
import type { ChatReferences } from "@/components/dashboard/use-chat-references";

export type ChatConnection = "idle" | "connecting" | "live" | "reconnecting" | "error";
export type SendPhase = "posting" | "accepted" | "failed";
export type ListState = "loading" | "ready" | "error";

/** The immutable tuple and attachment ids a send was dispatched with. */
export type SendSnapshot = {
  selection: ChatSelection;
  attachments: string[];
  references: string[];
};

export type PendingSend = {
  chatId: string;
  text: string;
  operationId: string;
  phase: SendPhase;
  error: string | null;
  /** Frozen at first dispatch; an uncertain retry reuses the same tuple. */
  frozen: SendSnapshot | null;
};

/** Chat plus operation identity for guarding send, retry and discard actions. */
export type OperationRef = { chatId: string; operationId: string };

/** A Stop request that froze one operation UUID and its chat at click time. */
export type StopTarget = OperationRef & { title: string };

export type ChatSelectionControls = {
  catalog: ChatCatalog | null;
  catalogError: string | null;
  entry: ChatCatalogEntry | null;
  selection: ChatSelection | null;
  /** True only when the loaded selection can actually be sent. */
  selectionReady: boolean;
  status: CapabilityLoadState;
  error: string | null;
  saving: boolean;
  notice: string | null;
  selectModel: (model: string) => void;
  selectEffort: (effort: ChatEffort) => void;
  retry: () => void;
};

export type UploadOutcome = { ok: true; ids: string[] } | { ok: false; error: string };

export type ChatFilesControls = {
  files: LocalFile[];
  notice: string | null;
  blockedReason: string | null;
  add: (incoming: File[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearNotice: () => void;
  ensureUploaded: (chatId: string, ids: readonly string[]) => Promise<UploadOutcome>;
  commit: (chatId: string, ids: readonly string[]) => void;
  discard: (chatId: string, ids: readonly string[]) => void;
};

export type ChatUsageControls = {
  usage: ChatUsage | null;
  status: CapabilityLoadState;
  error: string | null;
  /** True when the authoritative context is for a different preferred model. */
  mismatch: boolean;
  reload: () => void;
  /** Reloads authoritative model preferences, then re-reads usage. */
  reconcile: () => void;
};

export type ChatActionError = { title: string; message: string; dismissLabel: string };

export type ChatStoreValue = {
  chats: Chat[];
  listState: ListState;
  listError: string | null;
  selectedId: string | null;
  snapshot: ChatSnapshot | null;
  connection: ChatConnection;
  connectionError: string | null;
  actionError: string | null;
  catalogActionError: ChatActionError | null;
  reportCatalogError: (error: ChatActionError | null) => void;
  pendingSend: PendingSend | null;
  stopping: StopTarget | null;
  /** Current attachment generation; fences history/text/receipt requests. */
  attachment: string;
  creating: boolean;
  preferences: ChatSelectionControls;
  stagedFiles: ChatFilesControls;
  references: ChatReferences;
  usage: ChatUsageControls;
  select: (id: string | null) => void;
  startNewChat: () => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  send: (text: string, originChatId: string) => Promise<SendOutcome>;
  retrySend: (expected: OperationRef) => Promise<SendOutcome>;
  discardSend: (expected: OperationRef) => void;
  stop: (target: StopTarget) => Promise<void>;
  /** Exact loaded-row acknowledgment from a source chat; clears only a matching pending. */
  acknowledgeOperations: (chatId: string, operationIds: string[]) => void;
  reportError: (message: string | null) => void;
  reload: () => void;
  reloadList: () => void;
};

/**
 * A send that never dispatched must report why instead of resolving, so the
 * caller can throw MessageNotSentError and the runtime restores the draft it
 * cleared at dispatch time.
 */
export type SendOutcome = { status: "dispatched" } | { status: "blocked"; message: string };

/** The public descriptor list a sent user message carries, for the transcript. */
export type SentAttachments = ChatFileDescriptor[];

/**
 * True only when this exact operation is publicly visible: either as the
 * admitted input of the current run or as a committed message carrying the
 * operation UUID. A running flag or an unrelated new message is never proof of
 * this operation.
 */
export function hasOperation(snapshot: ChatSnapshot, operationId: string): boolean {
  return (
    snapshot.activeOperationId === operationId ||
    snapshot.messages.some((message) => message.operationId === operationId)
  );
}

export const ChatStoreContext = createContext<ChatStoreValue | null>(null);

export function useChatStore(): ChatStoreValue {
  const value = useContext(ChatStoreContext);
  if (!value) throw new Error("useChatStore must be used inside ChatStoreProvider.");
  return value;
}
