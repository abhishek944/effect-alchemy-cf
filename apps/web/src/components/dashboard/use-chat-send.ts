import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { newOperationId, type ChatSnapshot } from "@/lib/chat-api";
import type { ChatSelection } from "@/lib/chat-capability-types";
import {
  hasOperation,
  type ChatConnection,
  type ChatFilesControls,
  type OperationRef,
  type PendingSend,
  type SendOutcome,
  type SendSnapshot,
  type StopTarget,
} from "@/lib/chat-store-context";
import { dispatchSend } from "./chat-dispatch";
import { sendBlockReason, textTooLong } from "./chat-send-policy";
const matches = (pending: PendingSend | null, expected: OperationRef): pending is PendingSend =>
  pending !== null &&
  pending.chatId === expected.chatId &&
  pending.operationId === expected.operationId;
const BUSY = "Another send is waiting for Retry or Discard before a new message can be sent.";
const STOPPING = "An answer is being stopped. Try again once it is acknowledged.";
type Options = {
  pendingSend: PendingSend | null;
  connection: ChatConnection;
  selectionRef: RefObject<string | null>;
  snapshotRef: RefObject<ChatSnapshot | null>;
  stoppingRef: RefObject<StopTarget | null>;
  selection: ChatSelection | null;
  selectionReady: boolean;
  stagedFiles: ChatFilesControls;
  /** Idempotent release of one operation's frozen files (pending stays). */
  acceptFiles: (chatId: string, attachments: readonly string[]) => void;
  refreshList: () => void;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setPendingSend: Dispatch<SetStateAction<PendingSend | null>>;
};
/** A dispatch freezes its tuple and attachment ids; a retry reuses both. */
export function useChatSend({
  pendingSend,
  connection,
  selectionRef,
  snapshotRef,
  stoppingRef,
  selection,
  selectionReady,
  stagedFiles,
  acceptFiles,
  refreshList,
  setActionError,
  setPendingSend,
}: Options) {
  const inFlightRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingSend | null>(pendingSend);
  const filesRef = useRef(stagedFiles);
  useLayoutEffect(() => {
    pendingRef.current = pendingSend;
    filesRef.current = stagedFiles;
  }, [pendingSend, stagedFiles]);
  const failPending = useCallback(
    (operationId: string, message: string) => {
      setPendingSend((current) =>
        current?.operationId === operationId
          ? { ...current, phase: "failed", error: message }
          : current,
      );
    },
    [setPendingSend],
  );
  const submit = useCallback(
    async (chatId: string, text: string, operationId: string, frozen: SendSnapshot) => {
      if (inFlightRef.current || stoppingRef.current) return;
      inFlightRef.current = operationId;
      setActionError(null);
      const files = filesRef.current;
      const result = await dispatchSend(chatId, text, operationId, frozen, files);
      if (!result.ok) {
        failPending(operationId, result.error);
        inFlightRef.current = null;
        return;
      }
      // Confirmed acceptance releases only this operation's files; the
      // accepted/waiting record (and its Stop identity) stays until evidence settles it.
      acceptFiles(chatId, frozen.attachments);
      setPendingSend((current) => {
        if (current?.operationId !== operationId) return current;
        const latest = snapshotRef.current;
        if (latest && latest.chat.id === chatId && hasOperation(latest, operationId)) return null;
        return { ...current, phase: "accepted" };
      });
      refreshList();
      inFlightRef.current = null;
    },
    [
      acceptFiles,
      failPending,
      refreshList,
      setActionError,
      setPendingSend,
      snapshotRef,
      stoppingRef,
    ],
  );
  const send = useCallback(
    async (text: string, originChatId: string): Promise<SendOutcome> => {
      const current = snapshotRef.current;
      const trimmed = text.trim();
      const files = filesRef.current;
      const blocked = (message: string): SendOutcome => ({ status: "blocked", message });
      const long = textTooLong(trimmed);
      if (long) {
        setActionError(long);
        return blocked(long);
      }
      const reason = sendBlockReason({
        selectionMatches: selectionRef.current === originChatId,
        pending: pendingRef.current,
        inFlight: Boolean(inFlightRef.current),
        stopping: stoppingRef.current,
        snapshot: current,
        chatId: originChatId,
        connection,
        selectionReady: selectionReady && Boolean(selection),
        files,
        text: trimmed,
      });
      if (reason || !selection) return blocked(reason ?? STOPPING);
      const frozen: SendSnapshot = {
        selection,
        attachments: files.files.map((file) => file.id),
      };
      const operationId = newOperationId();
      setPendingSend({
        chatId: originChatId,
        text: trimmed,
        operationId,
        phase: "posting",
        error: null,
        frozen,
      });
      void submit(originChatId, trimmed, operationId, frozen);
      return { status: "dispatched" };
    },
    [
      connection,
      selection,
      selectionReady,
      selectionRef,
      setActionError,
      setPendingSend,
      snapshotRef,
      stoppingRef,
      submit,
    ],
  );
  const retrySend = useCallback(
    async (expected: OperationRef): Promise<SendOutcome> => {
      const blocked = (message: string): SendOutcome => {
        setActionError(message);
        return { status: "blocked", message };
      };
      const failed = pendingRef.current;
      if (stoppingRef.current) return blocked(STOPPING);
      if (inFlightRef.current) return blocked(BUSY);
      if (!failed || failed.phase !== "failed") return blocked("Nothing is waiting to be retried.");
      if (failed.chatId !== expected.chatId || failed.operationId !== expected.operationId)
        return blocked("This send is no longer waiting to be retried.");
      if (!failed.frozen)
        return blocked("This send lost its frozen settings. Discard and send again.");
      if (selectionRef.current !== failed.chatId)
        return blocked("This chat is no longer selected. Open it to retry.");
      setPendingSend((current) =>
        current?.operationId === failed.operationId
          ? { ...current, phase: "posting", error: null }
          : current,
      );
      await submit(failed.chatId, failed.text, failed.operationId, failed.frozen);
      return { status: "dispatched" };
    },
    [selectionRef, setActionError, setPendingSend, stoppingRef, submit],
  );
  const discardSend = useCallback(
    (expected: OperationRef) => {
      // Chat and exact operation must match before any file mutation.
      const current = pendingRef.current;
      if (!matches(current, expected)) return;
      setActionError(null);
      filesRef.current.discard(expected.chatId, current.frozen?.attachments ?? []);
      setPendingSend((cur) => (matches(cur, expected) ? null : cur));
    },
    [setActionError, setPendingSend],
  );
  return { send, retrySend, discardSend };
}
