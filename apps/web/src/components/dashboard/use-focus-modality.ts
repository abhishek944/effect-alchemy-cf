import { useLayoutEffect, useRef } from "react";

const navigationKeys = new Set([
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Keep pointer focus quiet and reserve navigation cues for keyboard use. */
export function useFocusModality() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const doc = root.ownerDocument;
    const pointer = () => root.setAttribute("data-focus-modality", "pointer");
    const keyboard = (event: KeyboardEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey && navigationKeys.has(event.key))
        root.setAttribute("data-focus-modality", "keyboard");
    };
    root.setAttribute("data-focus-modality", "keyboard");
    doc.addEventListener("pointerdown", pointer, true);
    doc.addEventListener("keydown", keyboard, true);
    return () => {
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("keydown", keyboard, true);
      root.removeAttribute("data-focus-modality");
    };
  }, []);
  return ref;
}
