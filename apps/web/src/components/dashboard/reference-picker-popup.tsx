/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Active-descendant combobox options. */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { useReferencePicker } from "./reference-picker";
import { useReferencePosition } from "./chat-reference-position";
import { ReferenceKindIcon } from "./reference-tray";
import "./chat-reference-picker.css";
export function ReferencePickerPopup({
  picker,
  anchor,
}: {
  picker: ReturnType<typeof useReferencePicker>;
  anchor: HTMLElement | null;
}) {
  const popup = useReferencePosition(anchor, picker.open);
  const { open, dismiss } = picker;
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
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, dismiss, popup, anchor]);
  const target = anchor?.closest("[data-dashboard]");
  if (!open || !target) return null;
  return createPortal(
    <section ref={popup} data-cx="chat-reference-picker" aria-label="Reference sources">
      <header>
        <strong>Reference sources</strong>
        <span>Choose exact scope</span>
      </header>
      <div
        role="listbox"
        data-cx="chat-reference-options"
        id={picker.listId}
        aria-label="Reference sources"
      >
        {picker.choices.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            role="option"
            id={`${picker.listId}-${index}`}
            tabIndex={-1}
            aria-selected={index === picker.activeIndex}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => picker.setIndex(index)}
            onClick={() => picker.choose(choice)}
          >
            <ReferenceKindIcon source={choice.source} />
            <span data-cx="chat-reference-option-copy">
              <strong>{choice.label}</strong>
              <small>
                {choice.source.kind === "native" ? "Native checkpoint" : "Saved original"}
              </small>
            </span>
          </button>
        ))}
      </div>
      {picker.lookup.state === "loading" && <output>Loading saved files…</output>}
      {picker.lookup.error && (
        <div role="alert">
          {picker.lookup.error}
          <button type="button" onClick={picker.lookup.retry}>
            Retry loading files
          </button>
        </div>
      )}
      {picker.lookup.state === "ready" && !picker.choices.length && (
        <output>No matching sources</output>
      )}
      <footer>
        <span>↑↓ choose · Enter add · Esc close</span>
        <button
          type="button"
          disabled={!picker.lookup.hasPrevious}
          onClick={picker.lookup.previous}
        >
          Previous
        </button>
        <button type="button" disabled={!picker.lookup.hasNext} onClick={picker.lookup.next}>
          More files
        </button>
      </footer>
    </section>,
    target,
  );
}
