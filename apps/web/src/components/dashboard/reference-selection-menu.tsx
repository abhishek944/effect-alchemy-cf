import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ReferenceSelectionMenu({
  anchor,
  label,
  onChoose,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  onChoose: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return undefined;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? innerWidth);
    const bottom = top + (viewport?.height ?? innerHeight);
    node.style.left = `${Math.max(left + 8, Math.min(rect.left, right - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(top + 8, Math.min(rect.bottom + 4, bottom - node.offsetHeight - 8))}px`;
    node.querySelector("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !node.contains(event.target)) onClose();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        anchor.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...node.querySelectorAll("button")];
        const index = buttons.findIndex((button) => button === document.activeElement);
        buttons[
          (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      }
      if (event.key === "Tab") onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);
  const target = anchor.closest("[data-dashboard]");
  if (!target) return null;
  return createPortal(
    <div ref={menu} role="menu" aria-label="Reference scope" data-cx="reference-selection-menu">
      <button type="button" role="menuitem" onClick={onChoose}>
        {label}
      </button>
      {children}
    </div>,
    target,
  );
}
