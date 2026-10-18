import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useHistoryText } from "./chat-history-ui";
import ChatIcon from "./chat-icon";
import Tooltip from "./tooltip";

/** Never use native getCopyText: it can contain only a bounded prefix. */
export function useMessageCopy() {
  const messageId = useAuiState((state) => state.message.id);
  const runtimeText = useAuiState((state) =>
    state.message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
  );
  const { textFor, copyAllowed } = useHistoryText();
  const loaded = textFor(messageId);
  return {
    ...loaded,
    scope: `${messageId}:${loaded.revision ?? ""}`,
    enabled:
      copyAllowed && loaded.complete && loaded.text.length > 0 && runtimeText === loaded.text,
  };
}

/** Clipboard feedback belongs to the exact text/revision, never a later render. */
export function CopyButton({
  text,
  scope,
  disabled,
  kind,
}: {
  text: string;
  scope: string;
  disabled: boolean;
  kind: "response" | "code";
}) {
  const [feedback, setFeedback] = useState<{
    text: string;
    scope: string;
    disabled: boolean;
    status: "copying" | "copied" | "failed";
  } | null>(null);
  const sameSource =
    feedback?.text === text && feedback.scope === scope && feedback.disabled === disabled;
  // Discard, not just hide: eligibility returning must never revive an old attempt.
  if (feedback && !sameSource) setFeedback(null);
  const status = sameSource ? feedback.status : "idle";
  const epoch = useRef(0);
  const current = useRef<{ text: string; scope: string; disabled: boolean } | null>(null);
  useLayoutEffect(() => {
    current.current = { text, scope, disabled };
    return () => {
      current.current = null;
      epoch.current += 1;
    };
  }, [text, scope, disabled]);
  useEffect(() => {
    if (status !== "copied") return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label = `Copy ${kind}`;
  const copy = async () => {
    const source = current.current;
    if (!source || source.disabled) return;
    const attempt = ++epoch.current;
    setFeedback({ ...source, status: "copying" });
    try {
      await navigator.clipboard.writeText(source.text);
      if (epoch.current === attempt) setFeedback({ ...source, status: "copied" });
    } catch {
      if (epoch.current === attempt) setFeedback({ ...source, status: "failed" });
    }
  };
  return (
    <>
      <Tooltip label={status === "copied" ? "Copied" : label}>
        <button
          type="button"
          data-cx="chat-copy"
          aria-label={label}
          disabled={disabled || status === "copying"}
          onClick={() => void copy()}
        >
          <ChatIcon name={status === "copied" ? "check" : "copy"} />
        </button>
      </Tooltip>
      <output data-cx="chat-sr-only">
        {status === "copied"
          ? `${kind === "code" ? "Code" : "Response"} copied.`
          : status === "failed"
            ? `Could not copy ${kind}. Check clipboard permission and try again.`
            : ""}
      </output>
    </>
  );
}
