import { useEffect, useState } from "react";
import { errorMessage, eventsUrl, getSnapshot, type ChatSnapshot } from "@/lib/chat-api";
import { parseSnapshotJson } from "@/lib/chat-validate";
import type { ChatConnection } from "@/lib/chat-store-context";
import { invalidateAccountTheme } from "./account-invalidate";

type StreamState = {
  snapshot: ChatSnapshot | null;
  connection: ChatConnection;
  connectionError: string | null;
};

type StreamRecord = StreamState & { chatId: string; attachment: string };

const BAD_FRAME = "This chat sent an update that could not be read. Try again to reconnect.";
const CLOSED = "The connection to this chat ended. Try again to reconnect.";

/**
 * Keeps one live EventSource for the selected chat. Readiness belongs to the
 * current attachment generation, so A/B/A or a manual reconnect cannot inherit
 * an earlier live record: cached history may show, but only a valid snapshot
 * from this attachment restores "live". A rejected frame or a terminal closed
 * stream marks the connection error while keeping cached history, and a late
 * GET may add history but never erase that state or re-enable readiness. The
 * connection only becomes send-ready on a received valid snapshot, and a
 * per-attachment `active` flag plus AbortController fence old selections.
 */
export function useChatStream(
  selectedId: string | null,
  attachment: string,
  settle: (snapshot: ChatSnapshot) => void,
): StreamState {
  const [record, setRecord] = useState<StreamRecord | null>(null);

  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    let active = true;
    let everReceived = false;
    // Only confirmed native transitions invalidate account state: a run that
    // settles, or a live connection that is re-established after a break.
    let wasRunning = false;
    let wasLive = false;
    const observe = (next: ChatSnapshot, live: boolean) => {
      if (wasRunning && !next.isRunning) invalidateAccountTheme("settled");
      wasRunning = next.isRunning;
      if (live && !wasLive) invalidateAccountTheme("reconnect");
      wasLive = live;
    };
    let terminal = false;
    const fail = (connectionError: string | null, connection: ChatConnection) => {
      // A lost or invalid connection is no longer live: the next valid snapshot
      // must invalidate account state even if no running->idle edge is observed.
      wasLive = false;
      setRecord((current) => ({
        chatId: selectedId,
        attachment,
        snapshot: current && current.chatId === selectedId ? current.snapshot : null,
        connection,
        connectionError,
      }));
    };
    const load = async () => {
      try {
        const next = await getSnapshot(selectedId, controller.signal);
        if (!active || everReceived || next.chat.id !== selectedId) return;
        observe(next, false);
        setRecord((current) =>
          // A late GET may add cached history but keeps the existing
          // attachment's connection, so a terminal error is never erased.
          current && current.chatId === selectedId && current.attachment === attachment
            ? { ...current, snapshot: next }
            : {
                chatId: selectedId,
                attachment,
                snapshot: next,
                connection: "connecting",
                connectionError: null,
              },
        );
        // Authoritative accepted proof settles the exact operation's files
        // without promoting this GET to a live/ready connection.
        settle(next);
      } catch (error) {
        if (!active || everReceived || terminal || controller.signal.aborted) return;
        fail(errorMessage(error), "error");
      }
    };
    void load();
    const source = new EventSource(eventsUrl(selectedId));
    source.addEventListener("snapshot", (event) => {
      if (!active || !(event instanceof MessageEvent) || typeof event.data !== "string") return;
      const next = parseSnapshotJson(event.data);
      if (!next || next.chat.id !== selectedId) {
        fail(BAD_FRAME, "error");
        return;
      }
      everReceived = true;
      observe(next, true);
      setRecord({
        chatId: selectedId,
        attachment,
        snapshot: next,
        connection: "live",
        connectionError: null,
      });
      settle(next);
    });
    source.addEventListener("error", () => {
      if (!active) return;
      if (source.readyState === EventSource.CLOSED) {
        terminal = true;
        fail(CLOSED, "error");
      } else {
        fail(null, "reconnecting");
      }
    });
    return () => {
      active = false;
      controller.abort();
      source.close();
    };
  }, [selectedId, attachment, settle]);

  if (!selectedId) return { snapshot: null, connection: "idle", connectionError: null };
  if (!record || record.chatId !== selectedId) {
    return { snapshot: null, connection: "connecting", connectionError: null };
  }
  if (record.attachment !== attachment) {
    return { snapshot: record.snapshot, connection: "connecting", connectionError: null };
  }
  return {
    snapshot: record.snapshot,
    connection: record.connection,
    connectionError: record.connectionError,
  };
}
