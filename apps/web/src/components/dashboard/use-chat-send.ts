import { useCallback, useLayoutEffect, useRef } from "react";
import type * as React from "react";
import { newOperationId, type ChatSnapshot } from "@/lib/chat-api";
import type { ChatSelection } from "@/lib/chat-capability-types";
import {
  hasOperation,
  type ChatConnection,
  type ChatFilesControls,
  type PendingSend,
  type SendOutcome,
  type SendSnapshot,
  type StopTarget,
} from "@/lib/chat-store-context";
import { dispatchSend } from "./chat-dispatch";
import { useWorkspaceOffice } from "./workspace-office-context";
import type { ChatReferences } from "./use-chat-references";
import { useChatSendRecovery } from "./use-chat-send-recovery";
import { sendBlockReason, textTooLong } from "./chat-send-policy";
const STOPPING = "An answer is being stopped. Try again once it is acknowledged.";
type Options = {
  pendingSend: PendingSend | null;
  connection: ChatConnection;
  selectionRef: React.RefObject<string | null>;
  snapshotRef: React.RefObject<ChatSnapshot | null>;
  stoppingRef: React.RefObject<StopTarget | null>;
  selection: ChatSelection | null;
  selectionReady: boolean;
  stagedFiles: ChatFilesControls;
  references: ChatReferences;
  /** Idempotent release of one operation's frozen files (pending stays). */
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
  references,
  acceptFiles,
  refreshList,
  setActionError,
  setPendingSend,
}: Options) {
  const inFlightRef = useRef<string | null>(null);
  const preparing = useRef(false);
  const { prepareSend } = useWorkspaceOffice();
  const pendingRef = useRef<PendingSend | null>(pendingSend);
  const filesRef = useRef(stagedFiles);
  const referencesRef = useRef(references);
  useLayoutEffect(() => {
    pendingRef.current = pendingSend;
    filesRef.current = stagedFiles;
    referencesRef.current = references;
  }, [pendingSend, stagedFiles, references]);
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
      acceptFiles(chatId, operationId, frozen.attachments, frozen.references ?? []);
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
        inFlight: Boolean(inFlightRef.current) || preparing.current,
        stopping: stoppingRef.current,
        snapshot: current,
        chatId: originChatId,
        connection,
        selectionReady: selectionReady && Boolean(selection),
        files,
        references: referencesRef.current,
        text: trimmed,
      });
      if (reason || !selection) return blocked(reason ?? STOPPING);
      const frozen: SendSnapshot = {
        selection,
        attachments: files.files.map((file) => file.id),
        references: [...referencesRef.current.ids],
      };
      preparing.current = true;
      try {
        const target = await prepareSend(originChatId);
        if (
          selectionRef.current !== originChatId ||
          stoppingRef.current !== null ||
          pendingRef.current !== null ||
          filesRef.current.files.map((file) => file.id).join(",") !==
            frozen.attachments.join(",") ||
          referencesRef.current.ids.join(",") !== frozen.references.join(",")
        )
          return blocked("The chat or staged files changed before Send. Nothing was uploaded.");
        if (target !== null) frozen.officeTarget = target;
      } catch {
        return blocked(
          "Office saves are unconfirmed. Save and reopen the displayed tab before sending.",
        );
      } finally {
        preparing.current = false;
      }
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
      prepareSend,
    ],
  );
  const { retrySend, discardSend } = useChatSendRecovery({
    pendingRef,
    filesRef,
    selectionRef,
    stoppingRef,
    inFlightRef,
    submit,
    setActionError,
    setPendingSend,
  });
  return { send, retrySend, discardSend };
}
