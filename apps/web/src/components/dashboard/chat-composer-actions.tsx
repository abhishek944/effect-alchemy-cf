import { useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useChatStore } from "@/lib/chat-store-context";
import { FILE_ACCEPT } from "@/lib/chat-file-local";
import { effortLabel } from "@/lib/chat-selection-labels";
import ChatIcon from "./chat-icon";
import { DropdownIndicator } from "./dropdown";
import ChatSetupOverlays, { type PickerKind } from "./chat-setup-overlays";
import Tooltip from "./tooltip";
import { useVoice } from "./chat-voice-bridge";

type PickerState = PickerKind | null;

/** Attachment → model → effort → flexible space → mic → Send/Stop, gap 4px. */
export default function ChatComposerActions({
  running,
  stopLabel,
  sendLabel,
  stopping,
  onStop,
  addFiles,
  submit,
  canSend,
  blockedReason,
}: {
  running: boolean;
  stopLabel: string;
  sendLabel: string;
  stopping: boolean;
  onStop?: (() => void) | undefined;
  addFiles: (files: File[]) => void;
  submit: () => Promise<void>;
  canSend: boolean;
  blockedReason: string | null;
}) {
  const store = useChatStore();
  const voice = useVoice();
  const { preferences, stagedFiles } = store;
  const aui = useAui();
  const dictation = useAuiState((state) => state.composer.dictation);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
  const [effortAnchor, setEffortAnchor] = useState<HTMLElement | null>(null);
  const connected = Boolean(store.snapshot) && store.connection === "live";
  const archived = Boolean(store.snapshot?.chat.archived);
  const modelName = preferences.entry?.name ?? preferences.selection?.model ?? null;

  return (
    <>
      <div data-cx="chat-actions">
        <input
          ref={fileInput}
          data-cx="file-input"
          type="file"
          multiple
          accept={FILE_ACCEPT}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Tooltip label="Add images or text files">
          <button
            type="button"
            data-cx="icon-button"
            aria-label="Add attachment"
            onClick={() => fileInput.current?.click()}
          >
            <ChatIcon name="plus" />
          </button>
        </Tooltip>
        <button
          type="button"
          data-cx="setup-control"
          data-kind="model"
          aria-haspopup="dialog"
          aria-expanded={picker === "model"}
          aria-label={`Chat model: ${
            preferences.catalogError ? "unavailable" : (modelName ?? "loading")
          }`}
          title={preferences.error ?? undefined}
          onClick={(event) => {
            setModelAnchor(event.currentTarget);
            setPicker(picker === "model" ? null : "model");
          }}
        >
          <span data-cx="setup-label">{modelName ?? "Model"}</span>
          <DropdownIndicator />
        </button>
        <button
          type="button"
          data-cx="setup-control"
          data-kind="effort"
          aria-haspopup="dialog"
          aria-expanded={picker === "effort"}
          aria-label={`Reasoning effort: ${
            preferences.selection ? effortLabel(preferences.selection.effort) : "loading"
          }`}
          disabled={!preferences.selection || (preferences.entry?.efforts.length ?? 0) === 0}
          title={
            preferences.catalogError ??
            (preferences.entry && preferences.entry.efforts.length === 0
              ? `${preferences.entry.name} does not support reasoning effort.`
              : undefined)
          }
          onClick={(event) => {
            setEffortAnchor(event.currentTarget);
            setPicker(picker === "effort" ? null : "effort");
          }}
        >
          <span>
            {preferences.selection ? effortLabel(preferences.selection.effort) : "Effort"}
          </span>
          <DropdownIndicator />
        </button>
        <div data-cx="chat-actions-spacer" />
        <Tooltip
          label={
            !voice?.supported
              ? (voice?.reason ?? "Dictation is unavailable in this browser")
              : dictation
                ? "Dictation is active"
                : "Start dictation"
          }
        >
          <button
            type="button"
            data-cx="icon-button"
            aria-label={voice?.supported ? "Start dictation" : "Use microphone: unavailable"}
            aria-pressed={Boolean(dictation)}
            disabled={!voice?.supported || Boolean(dictation) || archived || !connected}
            onClick={() => aui.composer.startDictation()}
          >
            <ChatIcon name="mic" />
          </button>
        </Tooltip>
        {running ? (
          <Tooltip label={stopLabel}>
            <button
              type="button"
              data-cx="chat-send"
              data-variant="stop"
              aria-label={stopLabel}
              disabled={!onStop || stopping}
              onClick={onStop}
            >
              <ChatIcon name="stop" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={blockedReason ?? stagedFiles.blockedReason ?? sendLabel}>
            <button
              type="button"
              data-cx="chat-send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void submit()}
            >
              <ChatIcon name="arrow-up" />
            </button>
          </Tooltip>
        )}
      </div>
      <ChatSetupOverlays
        picker={picker}
        preferences={preferences}
        modelAnchor={modelAnchor}
        effortAnchor={effortAnchor}
        onClose={() => setPicker(null)}
      />
    </>
  );
}
