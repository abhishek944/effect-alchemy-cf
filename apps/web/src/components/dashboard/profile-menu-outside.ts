/**
 * Outside-interaction closure for the photo actions menu.
 *
 * The menu request is cleared by the events that actually move the user away from it
 * — a pointer press outside, focus moving outside, or Enter/Space/Tab pressed on a
 * control outside — so visibility never needs to be adjusted from an effect. Focus
 * that was inside the menu is handed to a real field before the request is cleared.
 */
import type { RefObject } from "react";

export type MenuOutsidePorts = {
  readonly menu: RefObject<HTMLDivElement | null>;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  /** Hands focus to a real control when the menu currently holds it. */
  readonly releaseFocus: () => void;
  /** Clears the open request. */
  readonly close: () => void;
};

/** Installs the outside listeners and returns their cleanup. */
export const observeMenuOutside = (ports: MenuOutsidePorts): (() => void) => {
  const outside = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    return !ports.menu.current?.contains(target) && !ports.trigger.current?.contains(target);
  };
  const onPointer = (event: MouseEvent) => {
    if (!outside(event.target)) return;
    ports.releaseFocus();
    ports.close();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (outside(event.target)) ports.close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Tab") return;
    if (outside(event.target)) ports.close();
  };
  document.addEventListener("mousedown", onPointer);
  document.addEventListener("click", onPointer, true);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("keydown", onKey, true);
  return () => {
    document.removeEventListener("mousedown", onPointer);
    document.removeEventListener("click", onPointer, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("keydown", onKey, true);
  };
};
