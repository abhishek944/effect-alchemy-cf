/**
 * The one same-name decision for a Skills upload.
 *
 * The real Upload button is captured once and restored on close, so a quiet
 * list refresh cannot turn the saved trigger into Cancel. Cancel is the initial
 * focus; Escape is handled in capture phase and stops there; Tab and focusin
 * containment keep focus inside the dialog while the page stays visually
 * undimmed behind its transparent full-viewport barrier.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export default function SkillsReplaceDialog({
  filename,
  stale,
  onCancel,
  onReplace,
  returnFocusRef,
  fallbackFocusRef,
}: {
  filename: string;
  stale: boolean;
  onCancel: () => void;
  onReplace: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  /** Existing focusable Skills panel: used when Upload is disabled or gone. */
  fallbackFocusRef: { readonly current: HTMLElement | null };
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelHandlerRef = useRef(onCancel);

  useEffect(() => {
    cancelHandlerRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    const fallbackFocus = fallbackFocusRef.current;
    cancelRef.current?.focus();
    const focusFirst = () => {
      const first = dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
      (first ?? cancelRef.current)?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelHandlerRef.current();
        return;
      }
      if (event.key !== "Tab" || dialog === null) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (active === null || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialog !== null && event.target instanceof Node && !dialog.contains(event.target)) {
        event.stopPropagation();
        focusFirst();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      // Replace disables Upload before this cleanup; fall back to the panel and
      // never move focus when the route itself is unmounting.
      if (returnFocus !== null && returnFocus.isConnected && !returnFocus.disabled) {
        returnFocus.focus();
        return;
      }
      if (fallbackFocus !== null && fallbackFocus.isConnected) fallbackFocus.focus();
    };
  }, [fallbackFocusRef, returnFocusRef]);

  return (
    <div data-cx="skills-dialog-backdrop">
      <div data-cx="skills-dialog-dim">
        <section
          ref={dialogRef}
          data-cx="skills-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="skills-replace-title"
          aria-describedby="skills-replace-copy"
          tabIndex={-1}
        >
          <h2 id="skills-replace-title">Replace existing file?</h2>
          <p id="skills-replace-copy">
            {stale
              ? `${filename} changed since you picked it. Replace the newer version?`
              : `${filename} already exists. Replace it?`}
          </p>
          <div data-cx="skills-dialog-actions">
            <button ref={cancelRef} type="button" data-cx="skills-dialog-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" data-cx="skills-dialog-replace" onClick={onReplace}>
              Replace
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
