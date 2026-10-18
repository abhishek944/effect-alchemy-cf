/**
 * Loads the authoritative usage snapshot for one chat.
 *
 * The endpoint is required: a 503 or any other failure is reported as
 * unavailable with a manual Retry, never silently replaced by another
 * transport. The request key changes only at real settlement points — stream
 * attachment, source `usageRevision` (bumped after accounting writes such as
 * title or speech), the native committed context ceiling, the preferred model
 * epoch, and an observed run settling — never on partial text or token
 * revisions. Preferred-model context responses that no longer match are
 * dropped, so a preference change cannot install stale numbers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  capabilityMessage,
  getChatUsage,
  type CapabilityLoadState,
} from "@/lib/chat-capability-api";
import type { ChatUsage } from "@/lib/chat-capability-usage-types";
import type { ChatUsageControls } from "@/lib/chat-store-context";

type UsageRecord = {
  key: string;
  usage: ChatUsage | null;
  error: string | null;
  mismatch: boolean;
};

export function useChatUsage(
  chatId: string | null,
  running: boolean,
  attachment: string,
  preferredModel: string | null,
  usageRevision: string | null,
  ceilingEntryId: number | null,
): Omit<ChatUsageControls, "reconcile"> {
  const [record, setRecord] = useState<UsageRecord | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const previousRunning = useRef(running);
  const key = [
    chatId ?? "",
    attachment,
    preferredModel ?? "",
    usageRevision ?? "",
    ceilingEntryId === null ? "" : String(ceilingEntryId),
    String(reloadKey),
  ].join("|");

  useEffect(() => {
    if (!chatId) return undefined;
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const next = await getChatUsage(chatId);
        if (!active) return;
        if (
          preferredModel &&
          next.context.model !== null &&
          next.context.model !== preferredModel
        ) {
          // Recoverable: the tray can reconcile preferences and re-read usage.
          setRecord({
            key,
            usage: null,
            error: "Usage is reported for a different model than this chat's current choice.",
            mismatch: true,
          });
          return;
        }
        setRecord({ key, usage: next, error: null, mismatch: false });
      } catch (cause) {
        if (active && !controller.signal.aborted)
          setRecord({
            key,
            usage: null,
            error: capabilityMessage(cause, "Loading usage"),
            mismatch: false,
          });
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [chatId, key, preferredModel]);

  useEffect(() => {
    const wasRunning = previousRunning.current;
    previousRunning.current = running;
    if (wasRunning && !running) setReloadKey((value) => value + 1);
  }, [running]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const current = record && record.key === key ? record : null;
  const status: CapabilityLoadState = !chatId
    ? "idle"
    : current
      ? current.error
        ? "error"
        : "ready"
      : "loading";
  return useMemo(
    () => ({
      usage: current?.usage ?? null,
      status,
      error: current?.error ?? null,
      mismatch: current?.mismatch ?? false,
      reload,
    }),
    [current, reload, status],
  );
}
