import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import "./chat-popup.css";

const INSET = 8;

const focusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );

/**
 * One anchored overlay above the composer. Positioning is written straight to
 * CSS custom properties in a layout effect, so opening a menu never re-renders
 * the thread. It stays inside the chat pane's 8px inset, flips below only when
 * the above position cannot fit, then caps its height and scrolls.
 *
 * The positioning anchor and the focus-return target are separate concerns:
 * Escape restores the initiating control (`returnFocusTo`, falling back to the
 * anchor), while an outside pointer dismissal leaves native pointer focus alone.
 */
export default function PopupPanel({
  anchor,
  returnFocusTo,
  width,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  returnFocusTo?: HTMLElement | null;
  width: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor) return undefined;
    const measure = () => {
      const pane = anchor.closest('[data-cx="chat-page"]') ?? document.documentElement;
      const paneRect = pane.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      const available = Math.max(160, paneRect.width - INSET * 2);
      const effective = Math.min(width, available);
      panel.style.width = `${effective}px`;
      const height = panel.offsetHeight;
      const left = Math.min(
        Math.max(rect.left, paneRect.left + INSET),
        Math.max(paneRect.left + INSET, paneRect.right - INSET - effective),
      );
      let top = rect.top - height - INSET;
      let maxHeight = "none";
      if (top < paneRect.top + INSET) {
        const below = rect.bottom + INSET;
        if (below + height <= paneRect.bottom - INSET) top = below;
        else {
          top = paneRect.top + INSET;
          maxHeight = `${Math.max(120, paneRect.bottom - INSET - top)}px`;
        }
      }
      panel.style.width = "";
      panel.style.setProperty("--popup-left", `${left}px`);
      panel.style.setProperty("--popup-top", `${top}px`);
      panel.style.setProperty("--popup-width", `${effective}px`);
      panel.style.setProperty("--popup-max-height", maxHeight);
      panel.dataset.placed = "true";
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, width]);

  const close = useCallback(
    (restoreFocus: boolean) => {
      onClose();
      if (!restoreFocus) return;
      const target = returnFocusTo ?? anchor;
      if (target && target.isConnected) target.focus();
    },
    [anchor, onClose, returnFocusTo],
  );

  useEffect(() => {
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    target?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (panel?.contains(node) || anchor?.contains(node)) return;
      // A deliberate outside pointer target must keep the focus the browser gives it.
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Capture-phase consumption keeps an overlay Escape away from the SDK's
        // document-bubble speech cancel, so one Escape dismisses only the overlay.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusable(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, close]);

  return (
    <dialog
      ref={panelRef}
      open
      tabIndex={-1}
      data-cx="chat-popup"
      data-placed="false"
      aria-label={label}
    >
      {children}
    </dialog>
  );
}
