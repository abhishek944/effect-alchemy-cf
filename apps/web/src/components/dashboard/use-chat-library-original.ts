import { useEffect, useRef, useState } from "react";
import { getSavedFile, libraryReadMessage, readSavedOriginal } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";

type Result = { source: SavedFile; file: SavedFile; error: string | null };

/** Explicit, bounded read repair. Missing originals never turn into a paid retry. */
export function useChatLibraryOriginal(file: SavedFile, active = true) {
  const [result, setResult] = useState<Result | null>(null);
  const [reading, setReading] = useState<SavedFile | null>(null);
  const pending = useRef<{ file: SavedFile; controller: AbortController } | null>(null);
  useEffect(() => {
    if (!active) pending.current?.controller.abort();
    return () => {
      if (pending.current?.file === file) pending.current.controller.abort();
    };
  }, [file, active]);
  const retry = async () => {
    if (!active) return;
    pending.current?.controller.abort();
    const controller = new AbortController();
    pending.current = { file, controller };
    setReading(file);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const saved = await getSavedFile(file.chatId, file.id, signal);
      await readSavedOriginal(saved, signal);
      if (!controller.signal.aborted)
        setResult({ source: file, file: { ...saved, state: "ready" }, error: null });
    } catch (error) {
      if (!controller.signal.aborted)
        setResult({ source: file, file, error: libraryReadMessage(error) });
    } finally {
      if (pending.current?.controller === controller) {
        pending.current = null;
        setReading(null);
      }
    }
  };
  return {
    file: result?.source === file ? result.file : file,
    error: result?.source === file ? result.error : null,
    reading: active && reading === file,
    retry,
  };
}
