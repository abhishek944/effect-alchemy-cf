/**
 * One retained chat owner's published contract. A session never learns the visible selection:
 * its chat id is fixed at mount, so every async publication is chat-identity checked by
 * construction. Visibility only decides whether the facade projects it.
 *
 * Model preferences, usage and the reference adapter stay selected-view concerns in the facade.
 * This state is only the work that must outlive visibility: stream, pending Send, Stop, receipt
 * resolution and the owner's own failure message.
 */
import type { Chat, ChatSnapshot } from "@/lib/chat-api";
import type { ChatReferenceInputs } from "@starter/office-contract";
import type {
  ChatConnection,
  ChatPanelRequest,
  OperationRef,
  PendingSend,
  SendOutcome,
  StopTarget,
} from "@/lib/chat-store-context";

export type { ChatPanelRequest };
export type ChatSessionState = {
  chatId: string;
  snapshot: ChatSnapshot | null;
  connection: ChatConnection;
  connectionError: string | null;
  pendingSend: PendingSend | null;
  stopping: StopTarget | null;
  /** A Send is being prepared or submitted; releasing it now could lose the operation. */
  sending: boolean;
  /** Opaque history/receipt fence for this session lifetime. */
  attachment: string;
};
export type ChatSessionApi = {
  send: (text: string, referenceInputs?: ChatReferenceInputs) => Promise<SendOutcome>;
  retrySend: (expected: OperationRef) => Promise<SendOutcome>;
  discardSend: (expected: OperationRef) => void;
  stop: (target: StopTarget) => Promise<void>;
  acknowledge: (operationIds: string[]) => void;
};
export type ChatSessionEntry = {
  owner: object;
  state: ChatSessionState;
  api: ChatSessionApi;
};

/**
 * A hidden session is kept only while it owns real work. An idle, settled chat is released; when
 * the user returns it remounts and re-reads authoritative history, exactly like today's switch.
 * A connection error is not settlement: a recoverable frame keeps the existing EventSource, and a
 * known-running chat must keep its observation path until an authoritative snapshot says it ended.
 * No eviction policy, timer or queue: absence of work is the whole condition.
 */
export const retainsSession = (state: ChatSessionState): boolean =>
  state.sending ||
  state.pendingSend !== null ||
  state.stopping !== null ||
  state.snapshot?.isRunning === true;

/** Newest authoritative chat metadata for admission: catalog override wins at equal timestamps. */
export const newestChat = (live: Chat | null, override: Chat | undefined): Chat | null => {
  if (live === null) return override ?? null;
  if (override === undefined) return live;
  return Date.parse(override.updatedAt) >= Date.parse(live.updatedAt) ? override : live;
};
