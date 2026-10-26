import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type {
  ChatFilesControls,
  OperationRef,
  PendingSend,
  SendOutcome,
  SendSnapshot,
  StopTarget,
} from "@/lib/chat-store-context";

const matches = (pending: PendingSend | null, expected: OperationRef): pending is PendingSend =>
  pending !== null &&
  pending.chatId === expected.chatId &&
  pending.operationId === expected.operationId;

/** Retry reuses the exact frozen tuple. Discard touches uploads, never saved references. */
export function useChatSendRecovery(options: {
  pendingRef: RefObject<PendingSend | null>;
  readFiles: () => ChatFilesControls;
  stoppingRef: RefObject<StopTarget | null>;
  inFlightRef: RefObject<string | null>;
  submit: (
    chatId: string,
    text: string,
    operationId: string,
    frozen: SendSnapshot,
  ) => Promise<void>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setPendingSend: Dispatch<SetStateAction<PendingSend | null>>;
}) {
  const {
    pendingRef,
    readFiles,
    stoppingRef,
    inFlightRef,
    submit,
    setActionError,
    setPendingSend,
  } = options;
  const retrySend = useCallback(
    async (expected: OperationRef): Promise<SendOutcome> => {
      const blocked = (message: string): SendOutcome => {
        setActionError(message);
        return { status: "blocked", message };
      };
      const failed = pendingRef.current;
      if (stoppingRef.current)
        return blocked("An answer is being stopped. Try again once it is acknowledged.");
      if (inFlightRef.current)
        return blocked(
          "Another send is waiting for Retry or Discard before a new message can be sent.",
        );
      if (!failed || failed.phase !== "failed") return blocked("Nothing is waiting to be retried.");
      if (!matches(failed, expected))
        return blocked("This send is no longer waiting to be retried.");
      if (!failed.frozen)
        return blocked("This send lost its frozen settings. Discard and send again.");
      setPendingSend((current) =>
        current?.operationId === failed.operationId
          ? { ...current, phase: "posting", error: null }
          : current,
      );
      await submit(failed.chatId, failed.text, failed.operationId, {
        ...failed.frozen,
        references: failed.frozen.references ?? [],
      });
      return { status: "dispatched", operationId: failed.operationId };
    },
    [pendingRef, setActionError, setPendingSend, stoppingRef, inFlightRef, submit],
  );
  const discardSend = useCallback(
    (expected: OperationRef) => {
      const current = pendingRef.current;
      if (!matches(current, expected)) return;
      if (inFlightRef.current === current.operationId) {
        setActionError(
          "This message is still being submitted. Wait for it to settle before discarding.",
        );
        return;
      }
      setActionError(null);
      readFiles().discard(expected.chatId, current.frozen?.attachments ?? []);
      setPendingSend((value) => (matches(value, expected) ? null : value));
    },
    [pendingRef, readFiles, inFlightRef, setActionError, setPendingSend],
  );
  return { retrySend, discardSend };
}
