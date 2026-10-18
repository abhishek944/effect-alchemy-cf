import type { ChatSelectionControls } from "@/lib/chat-store-context";
import ChatEffortPicker from "./chat-effort-picker";
import ChatModelPicker from "./chat-model-picker";
import PopupPanel from "./chat-popup";

export type PickerKind = "model" | "effort";

/**
 * Model and effort overlays anchor to their own triggers; one overlay is open
 * at a time, and an honest save error or adjustment notice sits with them.
 * A model trigger opened without a catalog explains that failure and offers the
 * same Retry as the error line instead of opening nothing.
 */
export default function ChatSetupOverlays({
  picker,
  preferences,
  modelAnchor,
  effortAnchor,
  onClose,
}: {
  picker: PickerKind | null;
  preferences: ChatSelectionControls;
  modelAnchor: HTMLElement | null;
  effortAnchor: HTMLElement | null;
  onClose: () => void;
}) {
  return (
    <>
      {picker === "model" && preferences.catalog && (
        <ChatModelPicker
          anchor={modelAnchor}
          catalog={preferences.catalog}
          selection={preferences.selection}
          error={preferences.error}
          onSelect={preferences.selectModel}
          onClose={onClose}
        />
      )}
      {picker === "model" && !preferences.catalog && (
        <PopupPanel anchor={modelAnchor} width={300} label="Choose model" onClose={onClose}>
          <h2 data-cx="chat-popup-title">Choose model</h2>
          <p data-cx="chat-popup-alert" role="alert">
            {preferences.catalogError ?? "Chat models are still loading. Try again in a moment."}
          </p>
          <button type="button" data-cx="file-action" data-autofocus onClick={preferences.retry}>
            Retry
          </button>
        </PopupPanel>
      )}
      {picker === "effort" && (
        <ChatEffortPicker
          anchor={effortAnchor}
          entry={preferences.entry}
          selection={preferences.selection}
          error={preferences.error}
          notice={preferences.notice}
          onSelect={preferences.selectEffort}
          onClose={onClose}
        />
      )}
      {preferences.error && (
        <p data-cx="setup-error" role="alert">
          {preferences.error}
          <button type="button" data-cx="file-action" onClick={preferences.retry}>
            Retry
          </button>
        </p>
      )}
      {preferences.notice && !preferences.error && (
        <output data-cx="setup-notice">{preferences.notice}</output>
      )}
    </>
  );
}
