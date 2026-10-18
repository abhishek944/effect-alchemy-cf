import { useCallback, useEffect, useRef } from "react";
import type { ChatSnapshot } from "@/lib/chat-api";

// Finite reads around the title's 10s budget, never an ongoing catalog poller.
const REFRESH_DELAYS = [2000, 6000, 12000];

export function useBoundedCatalogRefresh(read: () => void) {
  const mounted = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const refresh = useCallback(() => {
    if (!mounted.current) return;
    timers.current.forEach(clearTimeout);
    read();
    timers.current = REFRESH_DELAYS.map((delay) =>
      setTimeout(() => {
        if (mounted.current) read();
      }, delay),
    );
  }, [read]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, [refresh]);
  return refresh;
}

/** Native acceptance also covers lost HTTP acknowledgments and other-tab sends. */
export function useChatMetadataRefresh(snapshot: ChatSnapshot | null, refresh: () => void) {
  const observed = useRef(new Set<string>());
  useEffect(() => {
    if (!snapshot) return;
    const operation =
      snapshot.activeOperationId ??
      snapshot.messages.findLast((message) => message.role === "user")?.operationId;
    if (!operation) return;
    const key = `${snapshot.chat.id}:${operation}`;
    const seen = observed.current;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 128) {
      const oldest = seen.values().next().value;
      if (oldest) seen.delete(oldest);
    }
    refresh();
  }, [snapshot, refresh]);
}
