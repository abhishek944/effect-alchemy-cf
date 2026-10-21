import { useEffect, useState } from "react";
import { getSavedFile, libraryReadMessage } from "@/lib/chat-library-api";
import type { LibraryReadState, SavedFile } from "@/lib/chat-library-types";

/** Metadata retry is a bounded GET of this exact identity, never a generation. */
export function useChatLibraryFile(chatId: string | null, fileId: string | null, active = true) {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{
    key: string;
    file: SavedFile | null;
    error: string | null;
  } | null>(null);
  const key = JSON.stringify([chatId, fileId, attempt]);
  useEffect(() => {
    if (!active || !chatId || !fileId) return undefined;
    const controller = new AbortController();
    void getSavedFile(chatId, fileId, controller.signal).then(
      (file) => {
        if (!controller.signal.aborted) setRead({ key, file, error: null });
        return undefined;
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setRead({ key, file: null, error: libraryReadMessage(error) });
      },
    );
    return () => controller.abort();
  }, [chatId, fileId, key, active]);
  const file = read?.key === key ? read.file : null;
  const error = read?.key === key ? read.error : null;
  const state: LibraryReadState = file ? "ready" : error ? "error" : "loading";
  return { file, state, error, retry: () => setAttempt((value) => value + 1) };
}
