import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { errorMessage, stopChat } from "@/lib/chat-api";
import type { StopTarget } from "@/lib/chat-store-context";

/**
 * Owns the targeted Stop lifecycle. The chat/operation pair is frozen by the
 * caller and never re-read after the await, and one Stop runs at a time.
 */
export function useChatStop(setActionError: Dispatch<SetStateAction<string | null>>) {
  const [stopping, setStopping] = useState<StopTarget | null>(null);
  const stoppingRef = useRef<StopTarget | null>(null);

  const stop = useCallback(
    async (target: StopTarget) => {
      if (stoppingRef.current) return;
      stoppingRef.current = target;
      setStopping(target);
      setActionError(null);
      try {
        await stopChat(target.chatId, target.operationId);
      } catch (error) {
        setActionError(`Stopping "${target.title}" failed. ${errorMessage(error)}`);
      } finally {
        stoppingRef.current = null;
        setStopping((current) =>
          current?.chatId === target.chatId && current.operationId === target.operationId
            ? null
            : current,
        );
      }
    },
    [setActionError],
  );

  return { stop, stopping, stoppingRef };
}
