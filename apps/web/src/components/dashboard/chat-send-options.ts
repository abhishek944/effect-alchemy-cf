import type * as React from "react";
import type { ChatSnapshot } from "@/lib/chat-api";
import type { ChatSelection } from "@/lib/chat-capability-types";
import type {
  ChatConnection,
  ChatFilesControls,
  PendingSend,
  StopTarget,
} from "@/lib/chat-store-context";
import type { ChatReferences } from "./use-chat-references";
export type ChatSendOptions = {
  /** The one chat this owner serves; a differently addressed Send is refused outright. */
  chatId: string;
  pendingSend: PendingSend | null;
  connection: ChatConnection;
  snapshotRef: React.RefObject<ChatSnapshot | null>;
  stoppingRef: React.RefObject<StopTarget | null>;
  selection: ChatSelection | null;
  selectionReady: boolean;
  /** Newest authoritative archive flag; a stale stream snapshot must not refuse a Send. */
  archived: boolean;
  /** Read at Send/discard time so admission always sees this chat's current staged rows. */
  readFiles: () => ChatFilesControls;
  references: ChatReferences;
  acceptFiles: (
    chatId: string,
    operationId: string,
    attachments: readonly string[],
    references: readonly string[],
  ) => void;
  refreshList: () => void;
  setActionError: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingSend: React.Dispatch<React.SetStateAction<PendingSend | null>>;
};
