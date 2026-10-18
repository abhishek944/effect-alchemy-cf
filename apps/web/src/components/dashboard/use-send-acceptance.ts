/**
 * Operation-scoped, idempotent local send acceptance.
 *
 * File release and pending settlement are separate: HTTP/native acceptance
 * releases only the operation's frozen files while the accepted/waiting record
 * (and its exact Stop identity) stays until authoritative evidence settles it.
 * Every path validates the exact chat and operation before any mutation.
 */
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatSnapshot } from "@/lib/chat-api";
import { hasOperation, type PendingSend } from "@/lib/chat-store-context";

export function useSendAcceptance(
  pendingSend: PendingSend | null,
  commit: (chatId: string, attachments: readonly string[]) => void,
  setPendingSend: Dispatch<SetStateAction<PendingSend | null>>,
) {
  const pendingRef = useRef<PendingSend | null>(pendingSend);
  useEffect(() => {
    pendingRef.current = pendingSend;
  }, [pendingSend]);

  /** Releases exactly the named frozen files for a confirmed acceptance. */
  const acceptFiles = useCallback(
    (chatId: string, attachments: readonly string[]) => {
      commit(chatId, attachments);
    },
    [commit],
  );

  /** Releases the current pending operation's files; terminal also clears it. */
  const acceptCurrent = useCallback(
    (chatId: string, operationId: string, terminal: boolean) => {
      const current = pendingRef.current;
      if (!current || current.chatId !== chatId || current.operationId !== operationId) return;
      commit(chatId, current.frozen?.attachments ?? []);
      if (terminal)
        setPendingSend((cur) =>
          cur?.chatId === chatId && cur.operationId === operationId ? null : cur,
        );
    },
    [commit, setPendingSend],
  );
  const acceptRef = useRef(acceptCurrent);
  useEffect(() => {
    acceptRef.current = acceptCurrent;
  }, [acceptCurrent]);

  /** Stable for the SSE subscription and receipt callback. */
  const onAccepted = useCallback((chatId: string, operationId: string, terminal: boolean) => {
    acceptRef.current(chatId, operationId, terminal);
  }, []);

  const settle = useCallback((next: ChatSnapshot) => {
    const current = pendingRef.current;
    if (!current || current.chatId !== next.chat.id) return;
    if (!hasOperation(next, current.operationId)) return;
    acceptRef.current(next.chat.id, current.operationId, true);
  }, []);

  const acknowledgeOperations = useCallback((chatId: string, operationIds: string[]) => {
    const current = pendingRef.current;
    if (current?.chatId === chatId && operationIds.includes(current.operationId))
      acceptRef.current(chatId, current.operationId, true);
  }, []);

  return { acceptFiles, onAccepted, settle, acknowledgeOperations };
}
