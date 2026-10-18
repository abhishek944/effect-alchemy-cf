/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The approved visual contract is a searchable grouped listbox, which a native select cannot express. */
import { useState } from "react";
import type { ChatCatalog, ChatSelection } from "@/lib/chat-capability-types";
import { CHAT_GROUPS } from "@/lib/chat-capability-types";
import PopupPanel from "./chat-popup";
import { moveRow, popupRows } from "./chat-popup-rows";

const GROUP_LABELS = { openai: "OpenAI", anthropic: "Claude" } as const;

function availabilityNote(entry: ChatCatalog["models"][number]): string {
  if (entry.availability === "not_enabled") return "Not enabled in this stage";
  if (entry.availability === "stage_unconfigured") return "Needs stage configuration";
  return entry.imageInput ? "Images · Text" : "Text";
}

/** Provider-grouped, searchable model list; unavailable choices stay readable. */
export default function ChatModelPicker({
  anchor,
  catalog,
  selection,
  onSelect,
  onClose,
  error,
}: {
  anchor: HTMLElement | null;
  catalog: ChatCatalog;
  selection: ChatSelection | null;
  onSelect: (model: string) => void;
  onClose: () => void;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const groups = CHAT_GROUPS.map((group) => ({
    group,
    models: catalog.models.filter(
      (entry) =>
        entry.group === group &&
        (needle === "" ||
          entry.name.toLowerCase().includes(needle) ||
          entry.vendorId.toLowerCase().includes(needle) ||
          entry.model.toLowerCase().includes(needle)),
    ),
  })).filter((section) => section.models.length > 0);

  return (
    <PopupPanel anchor={anchor} width={300} label="Choose model" onClose={onClose}>
      <h2 data-cx="chat-popup-title">Choose model</h2>
      <label className="sr-only" htmlFor="chat-model-search">
        Search chat models
      </label>
      <input
        id="chat-model-search"
        data-cx="chat-popup-search"
        data-autofocus
        type="search"
        placeholder="Search models"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Consume Enter: it must select a model, never submit the composer form.
            event.preventDefault();
            popupRows()
              .find((row) => row.getAttribute("aria-disabled") !== "true")
              ?.click();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveRow(1);
          }
        }}
      />
      {groups.map((section) => (
        <section key={section.group}>
          <p data-cx="chat-popup-group" role="presentation">
            {GROUP_LABELS[section.group]}
          </p>
          <div role="listbox" aria-label={`${GROUP_LABELS[section.group]} models`}>
            {section.models.map((entry) => {
              const disabled = entry.availability !== "enabled";
              return (
                <button
                  key={entry.model}
                  type="button"
                  data-cx="chat-popup-row"
                  role="option"
                  aria-selected={selection?.model === entry.model}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(entry.model);
                    onClose();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveRow(1);
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveRow(-1);
                    }
                  }}
                >
                  <span>
                    {entry.name}
                    <small data-cx="chat-popup-note">{availabilityNote(entry)}</small>
                  </span>
                  <span aria-hidden="true">
                    {selection?.model === entry.model ? "✓" : disabled ? "—" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {groups.length === 0 && <p data-cx="chat-popup-group">No matching models.</p>}
      <p data-cx="chat-popup-foot">Changes apply to this chat and your next new chat.</p>
      {error && (
        <p data-cx="chat-popup-alert" role="alert">
          {error}
        </p>
      )}
    </PopupPanel>
  );
}
