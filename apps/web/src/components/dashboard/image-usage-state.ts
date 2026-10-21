import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getImageUsage } from "@/lib/image-usage-api";
import { nativeImageMessageId } from "@/lib/image-usage-guards";
import type { ImageUsagePresentation } from "@/lib/image-usage-types";
import { ChatApiError } from "@/lib/chat-api";
import { useChatStore } from "@/lib/chat-store-context";
import { useHistoryText } from "./chat-history-ui";

type Read = {
  key: string;
  identity: string;
  value: ImageUsagePresentation | null;
  error: string | null;
};

function readError(error: unknown): string {
  if (error instanceof ChatApiError) return error.message;
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "Reading image costs timed out. Known amounts are kept.";
  return "Image cost records could not be read. Known amounts are kept.";
}

/** Mount inside the existing open popover. Reads never initiate or replay image work. */
export function useImageUsage({
  messageId,
  pending,
}: { messageId?: string | undefined; pending?: boolean | undefined } = {}) {
  const store = useChatStore();
  const { active } = useHistoryText();
  const chatId = store.selectedId;
  const snapshot = store.snapshot?.chat.id === chatId ? store.snapshot : null;
  const live = messageId !== undefined && !nativeImageMessageId(messageId);
  const enabled = active && Boolean(chatId && snapshot) && !live;
  const identity = JSON.stringify([chatId, messageId]);
  const [attempt, setAttempt] = useState(0);
  const phase = pending ?? Boolean(snapshot?.isRunning);
  const key = JSON.stringify([identity, store.attachment, snapshot?.usageRevision, phase, attempt]);
  const [read, setRead] = useState<Read | null>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ key, enabled });
  useLayoutEffect(() => {
    if (latest.current.key !== key || !enabled) request.current?.abort();
    latest.current = { key, enabled };
    return () => {
      request.current?.abort();
    };
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled || !chatId) return undefined;
    const controller = new AbortController();
    request.current = controller;
    const current = () =>
      !controller.signal.aborted && latest.current.key === key && latest.current.enabled;
    void getImageUsage(chatId, messageId, controller.signal).then(
      (value) => {
        if (current()) setRead({ key, identity, value, error: null });
        return undefined;
      },
      (error: unknown) => {
        if (current())
          setRead((previous) => ({
            key,
            identity,
            value: previous?.identity === identity ? previous.value : null,
            error: readError(error),
          }));
      },
    );
    return () => controller.abort();
  }, [chatId, messageId, enabled, key, identity]);
  const value = read?.identity === identity ? read.value : null;
  const error = read?.key === key ? read.error : null;
  const state = live
    ? "pending"
    : !enabled
      ? "idle"
      : read?.key !== key
        ? "loading"
        : error
          ? "error"
          : "ready";
  return { value, error, state, retry: () => setAttempt((count) => count + 1) };
}

export type ImageUsageRead = ReturnType<typeof useImageUsage>;
