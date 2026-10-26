import { useCallback, useState, useSyncExternalStore } from "react";
import type { OperationRef, SendOutcome, StopTarget } from "@/lib/chat-store-context";
import type { ChatSessionApi } from "./chat-session-types";
import { createChatSessionStore } from "./chat-session-store";

const NOT_OPEN = "This chat is still opening. Try again when it is ready.";

/**
 * Binds the retained-owner store to the facade: it subscribes to owner publications and exposes
 * the selected projection, retention list and chat-addressed routes. It starts no work itself.
 */
export function useChatSessionRegistry(selectedId: string | null) {
  const [store] = useState(createChatSessionStore);
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Derived from the store on every render; `revision` is the re-render trigger, not a value.
  const panelRequests = store.panelRequests();
  const runningChatIds = new Set<string>();
  for (const [chatId, session] of store.ordered()) {
    if (session.state.snapshot?.isRunning) runningChatIds.add(chatId);
  }
  const ownerIds = store.ownerIds(selectedId, panelRequests);
  const selected = store.entry(selectedId);
  const api = useCallback(
    (chatId: string): ChatSessionApi | null => store.entry(chatId)?.api ?? null,
    [store],
  );
  const reload = useCallback(() => {
    if (selectedId !== null) store.reload(selectedId);
  }, [selectedId, store]);
  const send = useCallback(
    async (
      text: string,
      originChatId: string,
      referenceInputs?: Parameters<ChatSessionApi["send"]>[1],
    ): Promise<SendOutcome> => {
      const owner = api(originChatId);
      return owner ? owner.send(text, referenceInputs) : { status: "blocked", message: NOT_OPEN };
    },
    [api],
  );
  const retrySend = useCallback(
    async (expected: OperationRef): Promise<SendOutcome> => {
      const owner = api(expected.chatId);
      return owner ? owner.retrySend(expected) : { status: "blocked", message: NOT_OPEN };
    },
    [api],
  );
  const discardSend = useCallback(
    (expected: OperationRef) => {
      api(expected.chatId)?.discardSend(expected);
    },
    [api],
  );
  const stop = useCallback(
    async (target: StopTarget) => {
      await api(target.chatId)?.stop(target);
    },
    [api],
  );
  const acknowledgeOperations = useCallback(
    (chatId: string, operationIds: string[]) => {
      api(chatId)?.acknowledge(operationIds);
    },
    [api],
  );
  return {
    selected,
    ownerIds,
    runningChatIds,
    panelRequests,
    epoch: store.epoch,
    publish: store.publish,
    remove: store.remove,
    claimPanelRequest: store.claim,
    reload,
    send,
    retrySend,
    discardSend,
    stop,
    acknowledgeOperations,
    error: store.error,
    reportError: store.setError,
  };
}
