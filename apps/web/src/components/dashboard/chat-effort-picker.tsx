/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The approved visual contract is an explained radio list, which a native select cannot express. */
import type { ChatCatalogEntry, ChatEffort, ChatSelection } from "@/lib/chat-capability-types";
import { effortLabel } from "@/lib/chat-selection-labels";
import PopupPanel from "./chat-popup";
import { edgeRow, moveRow } from "./chat-popup-rows";

const HINTS: Record<ChatEffort, string> = {
  off: "No reasoning",
  minimal: "Very little reasoning",
  low: "Less reasoning",
  medium: "Moderate reasoning",
  high: "More reasoning",
  xhigh: "Extended reasoning",
  max: "Maximum supported effort",
};

function keyMove(event: { key: string; preventDefault: () => void }): void {
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    event.preventDefault();
    moveRow(1);
  }
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    event.preventDefault();
    moveRow(-1);
  }
  if (event.key === "Home") {
    event.preventDefault();
    edgeRow("first");
  }
  if (event.key === "End") {
    event.preventDefault();
    edgeRow("last");
  }
}

/** Named supported-level list with a short explanation per observed level. */
export default function ChatEffortPicker({
  anchor,
  entry,
  selection,
  onSelect,
  onClose,
  notice,
  error,
}: {
  anchor: HTMLElement | null;
  entry: ChatCatalogEntry | null;
  selection: ChatSelection | null;
  onSelect: (effort: ChatEffort) => void;
  onClose: () => void;
  notice: string | null;
  error: string | null;
}) {
  const levels = entry?.efforts ?? [];

  return (
    <PopupPanel anchor={anchor} width={260} label="Reasoning effort" onClose={onClose}>
      <h2 data-cx="chat-popup-title">Reasoning effort</h2>
      <div role="radiogroup" aria-label="Reasoning effort">
        {levels.length === 0 && (
          <button type="button" data-cx="chat-popup-row" role="radio" aria-checked="true" disabled>
            <span>
              Off
              <small data-cx="chat-popup-note">This model does not support reasoning effort.</small>
            </span>
          </button>
        )}
        {levels.map((effort, index) => (
          <button
            key={effort}
            type="button"
            data-cx="chat-popup-row"
            role="radio"
            aria-checked={selection?.effort === effort}
            data-autofocus={selection?.effort === effort ? true : undefined}
            onClick={() => {
              onSelect(effort);
              onClose();
            }}
            onKeyDown={keyMove}
            aria-label={`${effortLabel(effort)}: ${HINTS[effort]}`}
            aria-posinset={index + 1}
            aria-setsize={levels.length}
          >
            <span>
              {effortLabel(effort)}
              <small data-cx="chat-popup-note">{HINTS[effort]}</small>
            </span>
            <span aria-hidden="true">{selection?.effort === effort ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      <p data-cx="chat-popup-foot">
        {levels.length > 0
          ? `Supported by ${entry?.name ?? "this model"}.`
          : "Only levels reported by the installed catalog are listed."}
      </p>
      {notice && <p data-cx="chat-popup-alert">{notice}</p>}
      {error && (
        <p data-cx="chat-popup-alert" role="alert">
          {error}
        </p>
      )}
    </PopupPanel>
  );
}
