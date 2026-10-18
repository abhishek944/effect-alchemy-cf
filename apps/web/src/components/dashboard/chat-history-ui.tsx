import { createContext, useContext, type ReactNode } from "react";
import type { ChatUsageAmount } from "@/lib/chat-capability-usage-types";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import type { HistoryGap } from "./chat-history";
import type { HistoryTextState } from "./use-chat-history";
import "./chat-history.css";

export type MessageFacts = { usage: ChatUsageAmount | null; pending: boolean };

type HistoryUiValue = {
  textFor: (messageId: string) => HistoryTextState;
  /** Sent originals of one committed user message; empty when none were sent. */
  attachmentsFor: (messageId: string) => ChatFileDescriptor[];
  /**
   * Raw stored creation timestamp for one message. Empty means unavailable:
   * the runtime's synthesized createdAt is never displayed.
   */
  stampFor: (messageId: string) => string;
  /** Attributed reported usage for one response, or an honest absence. */
  factsFor: (messageId: string) => MessageFacts;
  working: boolean;
  copyAllowed: boolean;
};

const HistoryUiContext = createContext<HistoryUiValue | null>(null);

export function HistoryUiProvider({
  value,
  children,
}: {
  value: HistoryUiValue;
  children: ReactNode;
}) {
  return <HistoryUiContext.Provider value={value}>{children}</HistoryUiContext.Provider>;
}

/** Safe defaults keep message rendering independent from history wiring. */
export function useHistoryText(): HistoryUiValue {
  return (
    useContext(HistoryUiContext) ?? {
      textFor: () => ({
        text: "",
        notice: null,
        complete: false,
        revision: null,
      }),
      attachmentsFor: () => [],
      stampFor: () => "",
      factsFor: () => ({ usage: null, pending: false }),
      working: false,
      copyAllowed: false,
    }
  );
}

/** Manual bounded history controls, shown only above the loaded window. */
export function HistoryControls({
  gap,
  newerUnloaded,
  hasOlder,
  loading,
  error,
  onLoadOlder,
  onLoadMissing,
  onReturnToLatest,
}: {
  gap: HistoryGap | null;
  newerUnloaded: boolean;
  hasOlder: boolean;
  loading: "older" | "missing" | null;
  error: string | null;
  onLoadOlder: () => void;
  onLoadMissing: () => void;
  onReturnToLatest: () => void;
}) {
  if (!gap && !hasOlder && !error && !newerUnloaded) return null;
  return (
    <div data-cx="history-controls">
      {newerUnloaded && (
        <output data-cx="history-gap">
          Newer messages are not loaded while you read this older section.
          <button type="button" data-cx="history-action" onClick={onReturnToLatest}>
            Return to latest
          </button>
        </output>
      )}
      {gap && (
        <output data-cx="history-gap">
          Earlier messages between this window and the saved history are not loaded.
          <button
            type="button"
            data-cx="history-action"
            disabled={loading !== null || !hasOlder}
            onClick={onLoadMissing}
          >
            {loading === "missing" ? "Loading…" : "Load missing messages"}
          </button>
        </output>
      )}
      {hasOlder && (
        <button
          type="button"
          data-cx="history-action"
          disabled={loading !== null}
          onClick={onLoadOlder}
        >
          {loading === "older" ? "Loading…" : "Load older"}
        </button>
      )}
      {error && (
        <p data-cx="history-gap" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Automatic text reads need no per-message buttons. */
export function MessageText({ messageId }: { messageId: string }) {
  const { textFor } = useHistoryText();
  const { notice } = textFor(messageId);
  return notice ? <output data-cx="history-text-status">{notice}</output> : null;
}
