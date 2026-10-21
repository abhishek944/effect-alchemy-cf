import { useEffect, useState } from "react";
import { getSavedFile } from "@/lib/chat-library-api";

/** Resolve source labels independently of transcript/pages, serially and time-bounded. */
export function useChatLibrarySources(
  chatId: string,
  sourceIds: readonly string[],
  active: boolean,
) {
  const key = JSON.stringify([chatId, sourceIds]);
  const [read, setRead] = useState<{ key: string; names: Readonly<Record<string, string>> } | null>(
    null,
  );
  useEffect(() => {
    if (!active || sourceIds.length === 0) return undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const run = async () => {
      const names: Record<string, string> = {};
      for (const id of new Set(sourceIds)) {
        if (signal.aborted) break;
        try {
          const source = await getSavedFile(chatId, id, signal);
          names[id] = source.name;
          if (!controller.signal.aborted) setRead({ key, names: { ...names } });
        } catch {
          // Missing labels retain the immutable source link; opening it can retry its metadata.
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [chatId, sourceIds, active, key]);
  return read?.key === key ? read.names : {};
}
