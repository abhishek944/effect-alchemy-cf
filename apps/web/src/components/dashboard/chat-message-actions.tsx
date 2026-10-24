import { useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { compactTime, fullTime } from "@/lib/chat-time";
import { CopyButton, useMessageCopy } from "./chat-copy";
import ChatIcon from "./chat-icon";
import ChatMessageFacts from "./chat-message-facts";
import { useHistoryText } from "./chat-history-ui";
import { useVoice, useVoicePlayback } from "./chat-voice-bridge";
import Tooltip from "./tooltip";
import "./chat-message-actions.css";

function TimeChip({ stamp }: { stamp: string }) {
  const compact = compactTime(stamp);
  const full = fullTime(stamp);
  if (!full)
    return (
      <span data-cx="message-time" data-state="unavailable">
        Time unavailable
      </span>
    );
  return (
    <Tooltip label={full}>
      <button type="button" data-cx="message-time" aria-label={full}>
        {compact}
      </button>
    </Tooltip>
  );
}

/** Quiet speaker before Copy; active playback becomes a square Stop read-aloud. */
function SpeakerButton({ canSpeak }: { canSpeak: boolean }) {
  const aui = useAui();
  const speech = useAuiState((state) => state.message.speech);
  const playback = useVoicePlayback();
  const voice = useVoice();
  const speaking = speech?.status.type === "starting" || speech?.status.type === "running";
  // Cancellation stays available while this button is Stop, regardless of start eligibility.
  const unavailable = !voice || (!speaking && !canSpeak);
  const label = speaking ? "Stop read-aloud" : "Read aloud";
  return (
    <>
      <Tooltip label={unavailable ? "Read aloud is unavailable for this reply" : label}>
        <button
          type="button"
          data-cx="message-speak"
          data-active={speaking ? "true" : undefined}
          aria-label={label}
          disabled={unavailable}
          onClick={() => {
            if (speaking) aui.thread.stopSpeaking();
            else aui.message.speak();
          }}
        >
          <ChatIcon name={speaking ? "stop" : "speaker"} />
        </button>
      </Tooltip>
      {speaking && playback && playback.playback.phase !== "idle" && (
        <output data-cx="chat-speak-status" aria-live="polite">
          {`Part ${playback.playback.chunkIndex + 1} of ${playback.playback.chunkCount}`}
          {playback.playback.skippedCode ? " · code skipped" : ""}
        </output>
      )}
    </>
  );
}

/** Time comes from the raw stored stamp, never the runtime's synthesized createdAt. */
export function AssistantActions({
  optimistic,
  attachmentsOnly = false,
  toolOnly = false,
}: {
  optimistic: boolean;
  attachmentsOnly?: boolean;
  toolOnly?: boolean;
}) {
  const messageId = useAuiState((state) => state.message.id);
  const { factsFor, stampFor } = useHistoryText();
  const copy = useMessageCopy();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const facts = factsFor(messageId);
  if (optimistic) return null;
  if (attachmentsOnly) {
    if (copy.text.length === 0) return null;
    return (
      <div data-cx="chat-reply-actions">
        <CopyButton text={copy.text} scope={copy.scope} disabled={!copy.enabled} kind="response" />
      </div>
    );
  }

  return (
    <div data-cx="chat-reply-actions">
      <TimeChip stamp={stampFor(messageId)} />
      {!toolOnly && <SpeakerButton canSpeak={copy.enabled} />}
      {copy.text.length > 0 && (
        <CopyButton text={copy.text} scope={copy.scope} disabled={!copy.enabled} kind="response" />
      )}
      <button
        type="button"
        data-cx="message-more"
        aria-label="Response facts"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setOpen((value) => !value);
        }}
      >
        <ChatIcon name="ellipsis" />
      </button>
      {open && (
        <ChatMessageFacts
          usage={facts.usage}
          pending={facts.pending}
          anchor={anchor}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** User bubble tail: raw stored creation time on hover/focus, never fabricated. */
export function UserActions({ optimistic }: { optimistic: boolean }) {
  const messageId = useAuiState((state) => state.message.id);
  const { stampFor } = useHistoryText();
  if (optimistic) return null;
  return (
    <div data-cx="chat-user-meta">
      <TimeChip stamp={stampFor(messageId)} />
    </div>
  );
}
