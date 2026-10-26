import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { freezeOfficeSendTarget, type ChatReferenceInputs } from "@starter/office-contract";
import { freezeSendDraft, normalizeReferenceCaption } from "./reference-send";
import { newOperationId } from "@/lib/chat-api";
import type { ChatSendOptions } from "./chat-send-options";
import {
  hasOperation,
  type PendingSend,
  type SendOutcome,
  type SendSnapshot,
} from "@/lib/chat-store-context";
import { dispatchSend } from "./chat-dispatch";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useReferenceWorkspace } from "./reference-workspace";
import { useChatSendRecovery } from "./use-chat-send-recovery";
import { sendBlockReason, textTooLong } from "./chat-send-policy";
const STOPPING = "An answer is being stopped. Try again once it is acknowledged.";

export function useChatSend({
  chatId,
  pendingSend,
  connection,
  snapshotRef,
  stoppingRef,
  selection,
  selectionReady,
  archived,
  readFiles,
  references,
  acceptFiles,
  refreshList,
  setActionError,
  setPendingSend,
}: ChatSendOptions) {
  const inFlightRef = useRef<string | null>(null);
  const preparing = useRef(false);
  // Published so the facade never releases an owner whose Send is being prepared.
  const [sending, setSending] = useState(false);
  const { prepareSend } = useWorkspaceOffice();
  const { sendTarget } = useReferenceWorkspace();
  const pendingRef = useRef<PendingSend | null>(pendingSend);
  const referencesRef = useRef(references);
  useLayoutEffect(() => {
    pendingRef.current = pendingSend;
    referencesRef.current = references;
  }, [pendingSend, references]);
  const submit = useCallback(
    async (targetChatId: string, text: string, operationId: string, frozen: SendSnapshot) => {
      if (inFlightRef.current || stoppingRef.current) return;
      inFlightRef.current = operationId;
      setActionError(null);
      const result = await dispatchSend(targetChatId, text, operationId, frozen, readFiles());
      if (!result.ok) {
        setPendingSend((current) =>
          current?.operationId === operationId
            ? { ...current, phase: "failed", error: result.error }
            : current,
        );
        inFlightRef.current = null;
        return;
      }
      acceptFiles(targetChatId, operationId, frozen.attachments, frozen.references ?? []);
      setPendingSend((current) => {
        if (current?.operationId !== operationId) return current;
        const latest = snapshotRef.current;
        if (latest && latest.chat.id === targetChatId && hasOperation(latest, operationId))
          return null;
        return { ...current, phase: "accepted" };
      });
      refreshList();
      inFlightRef.current = null;
    },
    [acceptFiles, readFiles, refreshList, setActionError, setPendingSend, snapshotRef, stoppingRef],
  );
  const send = useCallback(
    async (
      text: string,
      originChatId: string,
      referenceInputs: ChatReferenceInputs = [],
    ): Promise<SendOutcome> => {
      const blocked = (message: string): SendOutcome => ({ status: "blocked", message });
      const files = readFiles();
      // The facade routes by chat; a mismatched address is refused instead of acting on this owner.
      if (originChatId !== chatId)
        return blocked("This message belongs to a different chat. Nothing was sent.");
      let caption: ReturnType<typeof normalizeReferenceCaption>;
      try {
        caption = normalizeReferenceCaption(text, referenceInputs);
      } catch (error) {
        return blocked(error instanceof Error ? error.message : "Reference invalid.");
      }
      const trimmed = caption.text;
      const long = textTooLong(trimmed);
      if (long) {
        setActionError(long);
        return blocked(long);
      }
      const reason = sendBlockReason({
        pending: pendingRef.current,
        inFlight: Boolean(inFlightRef.current) || preparing.current,
        stopping: stoppingRef.current,
        snapshot: snapshotRef.current,
        chatId: originChatId,
        archived,
        connection,
        selectionReady: selectionReady && Boolean(selection),
        files,
        references: referencesRef.current,
        text: trimmed,
      });
      if (reason || !selection) return blocked(reason ?? STOPPING);
      let frozen: SendSnapshot;
      try {
        frozen = freezeSendDraft(trimmed, {
          selection,
          attachments: files.files.map((file) => file.id),
          references: referencesRef.current.ids,
          referenceInputs: caption.inputs,
        });
      } catch (error) {
        return blocked(error instanceof Error ? error.message : "Reference invalid.");
      }
      const explicit = Boolean(
        frozen.attachments.length || frozen.references.length || frozen.referenceInputs?.length,
      );
      preparing.current = true;
      setSending(true);
      try {
        const target = await prepareSend(originChatId, explicit);
        // Switching chats may hide this editor, but it must not invalidate the frozen Send.
        if (
          stoppingRef.current !== null ||
          pendingRef.current !== null ||
          readFiles()
            .files.map((file) => file.id)
            .join(",") !== frozen.attachments.join(",") ||
          referencesRef.current.ids.join(",") !== frozen.references.join(",")
        )
          return blocked("The staged files changed before Send. Nothing was uploaded.");
        if (target !== null) {
          // Explicit tokens alone choose context; keep the displayed identity, not new observations.
          const { context: _observed, ...identity } = target;
          frozen.officeTarget = frozen.referenceInputs?.length
            ? freezeOfficeSendTarget(identity)
            : sendTarget(originChatId, target);
        }
      } catch {
        return blocked(
          "Office saves are unconfirmed. Save and reopen the displayed tab before sending.",
        );
      } finally {
        preparing.current = false;
        setSending(false);
      }
      Object.freeze(frozen);
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
      return { status: "dispatched", operationId };
    },
    [
      archived,
      connection,
      chatId,
      readFiles,
      selection,
      selectionReady,
      setActionError,
      setPendingSend,
      snapshotRef,
      stoppingRef,
      submit,
      prepareSend,
      sendTarget,
    ],
  );
  const { retrySend, discardSend } = useChatSendRecovery({
    pendingRef,
    readFiles,
    stoppingRef,
    inFlightRef,
    submit,
    setActionError,
    setPendingSend,
  });
  return { send, retrySend, discardSend, sending };
}
