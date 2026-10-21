/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Approved thumbnail rows need a custom active-descendant listbox. */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ChatReferencePicker } from "./use-chat-references-picker";
import { ChatLibraryThumbnail } from "./chat-library-thumbnail";
import { savedIdentityLabel, savedOrigin, savedTime } from "./chat-library-format";
import { useReferencePosition } from "./chat-reference-position";
import "./chat-reference-picker.css";

export function ChatReferencePickerPopup({
  picker,
  anchor,
}: {
  picker: ChatReferencePicker;
  /** Native controlled textarea; supplies bounds and receives restored focus. */
  anchor: HTMLTextAreaElement | null;
}) {
  const popup = useReferencePosition(anchor, picker.open);
  const { open, dismiss, activeId } = picker;
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !anchor?.contains(event.target)
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      anchor?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [anchor, open, dismiss, popup]);
  useEffect(() => {
    if (!open || !activeId) return;
    const option = document.getElementById(picker.optionId(activeId));
    if (option && popup.current?.contains(option)) option.scrollIntoView({ block: "nearest" });
  }, [open, activeId, picker, popup]);
  const target = anchor?.closest("[data-dashboard]");
  if (!open || !target) return null;
  return createPortal(
    <section ref={popup} data-cx="chat-reference-picker" aria-label="Saved files in this chat">
      <header>
        <strong>Files in this chat</strong>
        <span>Type a name to filter</span>
      </header>
      <div
        data-cx="chat-reference-options"
        role="listbox"
        id={picker.listId}
        aria-label="Saved files"
        aria-busy={picker.state === "loading"}
      >
        {picker.files.map((file) => (
          <button
            key={file.id}
            id={picker.optionId(file.id)}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={picker.activeId === file.id}
            aria-disabled={file.state !== "ready"}
            aria-label={savedIdentityLabel(file)}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => picker.activate(file.id)}
            onClick={() => picker.choose(file)}
          >
            <ChatLibraryThumbnail file={file} active={open} />
            <span data-cx="chat-reference-option-copy">
              <strong>{file.name}</strong>
              <small>
                {savedOrigin(file)} · {savedTime(file)}
                {file.state !== "ready" ? " · Unavailable" : ""}
              </small>
            </span>
          </button>
        ))}
      </div>
      {picker.state === "loading" && (
        <div data-cx="chat-reference-picker-state" aria-live="polite">
          Loading saved files…
        </div>
      )}
      {picker.state === "error" && (
        <div data-cx="chat-reference-picker-state" role="alert">
          <strong>Could not load saved files</strong>
          <p>{picker.error} Your draft is unchanged.</p>
          <button
            type="button"
            onClick={() => {
              picker.retry();
              anchor?.focus();
            }}
          >
            Retry loading files
          </button>
        </div>
      )}
      {picker.state === "ready" && !picker.files.length && (
        <div data-cx="chat-reference-picker-state" aria-live="polite">
          <strong>No matching saved files</strong>
          <p>Try another name. Only files saved in this chat appear here.</p>
        </div>
      )}
      <footer>
        <span>↑↓ choose · Enter add to draft · Esc close</span>
        {(picker.hasPrevious || picker.hasNext) && (
          <span data-cx="chat-reference-page-actions">
            <button
              type="button"
              disabled={!picker.hasPrevious}
              onClick={() => {
                picker.previous();
                anchor?.focus();
              }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!picker.hasNext || picker.state !== "ready"}
              onClick={() => {
                picker.next();
                anchor?.focus();
              }}
            >
              More files
            </button>
          </span>
        )}
      </footer>
    </section>,
    target,
  );
}
