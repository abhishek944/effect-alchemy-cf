import { useAuiState } from "@assistant-ui/react";
import type { ChatInputSelection } from "@/lib/chat-selection-types";
import { AttachmentFallback } from "./attachment-fallback";
import { useHistoryText } from "./chat-history-ui";
import "./chat-message-selections.css";

function SelectionLabel({ selection }: { selection: ChatInputSelection }) {
  return (
    <>
      <span data-cx="sent-selection-icon">
        <AttachmentFallback />
      </span>
      <span data-cx="sent-selection-copy">
        <span data-cx="sent-selection-name" title={selection.name}>
          {selection.name}
        </span>
        <span data-cx="sent-selection-scope">
          {selection.scope}
          {selection.scope !== "Selected text" ? " · selected cells" : ""}
        </span>
      </span>
    </>
  );
}

/** Only immutable, included selection strings are supplied here; no live editor reads. */
export function SentSelections({ selections }: { selections: readonly ChatInputSelection[] }) {
  if (!selections.length) return null;
  return (
    <section data-cx="sent-selections" aria-label="Selected areas">
      <div data-cx="sent-evidence-label">Selected areas · {selections.length}</div>
      {selections.map((selection, index) =>
        selection.scope === "Selected text" ? (
          <details data-cx="sent-selection-row" key={index}>
            <summary>
              <SelectionLabel selection={selection} />
            </summary>
            <div data-cx="sent-selection-reveal">
              {selection.quote === null ? (
                <span data-cx="sent-selection-unavailable">Stored quotation unavailable.</span>
              ) : (
                <blockquote>{selection.quote}</blockquote>
              )}
            </div>
          </details>
        ) : (
          <div data-cx="sent-selection-row" key={index}>
            <SelectionLabel selection={selection} />
          </div>
        ),
      )}
    </section>
  );
}

export function SentMessageSelections() {
  const messageId = useAuiState((state) => state.message.id);
  const { selectionsFor } = useHistoryText();
  return <SentSelections selections={selectionsFor(messageId)} />;
}
