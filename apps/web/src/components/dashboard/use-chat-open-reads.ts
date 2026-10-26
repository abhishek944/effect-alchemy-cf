import { useCallback, useEffect, useRef, useState } from "react";
import { getSavedFile, libraryReadMessage } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";

export type ChatOpenRead = {
  fileId: string;
  /** `ready` keeps a completed explicit open visible until the next request or dismiss. */
  state: "loading" | "ready" | "error";
  error: string | null;
};

/**
 * Account-scoped explicit saved-file opens. The request and its publication belong to the origin
 * chat, so unmounting a message row or conversation cannot cancel work that was already started.
 * Only a repeated attempt for the same chat/file supersedes an earlier one; distinct files proceed
 * independently. Account teardown aborts the rest. Fresh server authorization is required per read.
 */
export function useChatOpenReads() {
  const [reads, setReads] = useState<Readonly<Record<string, ChatOpenRead>>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const patch = useCallback((chatId: string, next: ChatOpenRead) => {
    setReads((current) => ({ ...current, [chatId]: next }));
  }, []);
  const openSavedFile = useCallback(
    (
      chatId: string,
      fileId: string,
      reveal: boolean,
      publish: (chatId: string, file: SavedFile, reveal: boolean) => void,
    ) => {
      const intent = `${chatId}/${fileId}`;
      controllers.current.get(intent)?.abort();
      const controller = new AbortController();
      controllers.current.set(intent, controller);
      patch(chatId, { fileId, state: "loading", error: null });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      void getSavedFile(chatId, fileId, signal)
        .then(
          (file) => {
            if (signal.aborted) return undefined;
            publish(chatId, file, reveal);
            patch(chatId, { fileId, state: "ready", error: null });
            return undefined;
          },
          (error: unknown) => {
            if (controller.signal.aborted) return undefined;
            patch(chatId, { fileId, state: "error", error: libraryReadMessage(error) });
            return undefined;
          },
        )
        .finally(() => {
          if (controllers.current.get(intent) === controller) controllers.current.delete(intent);
        });
    },
    [patch],
  );
  // Dismissing an error is not cancellation; a stale button cannot clear a newer read.
  const dismiss = useCallback((chatId: string, read: ChatOpenRead) => {
    setReads((current) => {
      if (current[chatId] !== read) return current;
      const next = { ...current };
      delete next[chatId];
      return next;
    });
  }, []);
  const cancelFiles = useCallback((chatId: string, fileIds: readonly string[]) => {
    for (const fileId of fileIds) {
      const intent = `${chatId}/${fileId}`;
      controllers.current.get(intent)?.abort();
      controllers.current.delete(intent);
    }
    setReads((current) => {
      if (!fileIds.includes(current[chatId]?.fileId ?? "")) return current;
      const next = { ...current };
      delete next[chatId];
      return next;
    });
  }, []);
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
    },
    [],
  );
  return { reads, openSavedFile, dismiss, cancelFiles };
}
