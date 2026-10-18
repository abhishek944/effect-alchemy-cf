import { useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatSnapshot } from "@/lib/chat-api";
import { getOperationReceipt } from "@/lib/chat-history-api";
import { hasOperation, type PendingSend } from "@/lib/chat-store-context";

export const UNCONFIRMED =
  "Acceptance of this message could not be confirmed. Retry with the same request, or discard it.";

type Options = {
  pendingSend: PendingSend | null;
  snapshot: ChatSnapshot | null;
  selectedId: string | null;
  attachment: string;
  chatTitle: string;
  setPendingSend: Dispatch<SetStateAction<PendingSend | null>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  /** Exact acceptance evidence: files release always, pending clears only when terminal. */
  onAccepted: (chatId: string, operationId: string, terminal: boolean) => void;
};

/**
 * Queries the exact native receipt when a retained pending UUID is outside the
 * loaded window. Accepted unsettled keeps the verified waiting state; a settled
 * receipt clears only that exact pending slot and labels any safe failure by
 * chat; an unconfirmed receipt keeps UUID and text for explicit Retry/Discard.
 * Receipts never infer acceptance from text or a run, and never touch Send
 * readiness.
 */
export function useOperationReceipt({
  pendingSend,
  snapshot,
  selectedId,
  attachment,
  chatTitle,
  setPendingSend,
  setActionError,
  onAccepted,
}: Options) {
  const inFlightRef = useRef<string | null>(null);
  const pendingRef = useRef(pendingSend);

  // Layout effect keeps the ref authoritative for any callback after this commit.
  useLayoutEffect(() => {
    pendingRef.current = pendingSend;
  }, [pendingSend]);

  useEffect(() => {
    const pending = pendingSend;
    if (!pending || !snapshot || !selectedId) return undefined;
    if (pending.chatId !== selectedId || snapshot.chat.id !== pending.chatId) return undefined;
    if (pending.phase === "posting") return undefined;
    if (hasOperation(snapshot, pending.operationId)) {
      // Authoritative transcript proof: release the frozen files and settle now,
      // even if the events connection never delivered the frame.
      onAccepted(pending.chatId, pending.operationId, true);
      return undefined;
    }
    const key = `${attachment}:${pending.operationId}`;
    if (inFlightRef.current === key) return undefined;
    inFlightRef.current = key;
    const controller = new AbortController();
    let active = true;
    const run = async () => {
      try {
        const receipt = await getOperationReceipt(
          pending.chatId,
          pending.operationId,
          controller.signal,
        );
        if (!active || receipt.operationId !== pending.operationId) return;
        const stillCurrent = pendingRef.current?.operationId === receipt.operationId;
        if (!receipt.accepted) {
          // Missing acceptance must not hide the original setup, quota or network error.
          setPendingSend((current) => {
            if (!current || current.operationId !== receipt.operationId) return current;
            return current.phase === "failed" && current.error !== null
              ? current
              : { ...current, phase: "failed", error: UNCONFIRMED };
          });
          return;
        }
        if (receipt.settled) {
          // A settled receipt is authoritative acceptance: release files and settle.
          if (stillCurrent) onAccepted(pending.chatId, receipt.operationId, true);
          if (receipt.error) setActionError(`"${chatTitle}": ${receipt.error}`);
          return;
        }
        // Accepted but unsettled: release the frozen files while keeping the
        // accepted/waiting record and its exact Stop identity.
        if (stillCurrent) onAccepted(pending.chatId, receipt.operationId, false);
        setPendingSend((current) =>
          !current || current.operationId !== receipt.operationId
            ? current
            : current.phase === "accepted" && current.error === null
              ? current
              : { ...current, phase: "accepted", error: null },
        );
      } catch {
        // Keep the uncertain state; a later snapshot may retry the receipt.
      } finally {
        if (inFlightRef.current === key) inFlightRef.current = null;
      }
    };
    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    attachment,
    chatTitle,
    onAccepted,
    pendingSend,
    selectedId,
    setActionError,
    setPendingSend,
    snapshot,
  ]);
}
