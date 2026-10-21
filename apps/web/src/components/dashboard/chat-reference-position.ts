import { useLayoutEffect, useRef } from "react";

/** Above the controlled draft, clamped to its chat and the visual viewport. */
export function useReferencePosition(anchor: HTMLElement | null, open: boolean) {
  const popup = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = popup.current;
    if (!anchor || !open || !node) return undefined;
    const pane = anchor.closest('[data-cx="chat-page"]') ?? anchor.closest("[data-dashboard]");
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const chat = pane?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const right = Math.min(
        chat?.right ?? innerWidth,
        viewportLeft + (viewport?.width ?? innerWidth),
      );
      const leftEdge = Math.max(chat?.left ?? 0, viewportLeft);
      const topEdge = Math.max(chat?.top ?? 0, viewportTop);
      const width = Math.max(0, Math.min(420, rect.width, right - leftEdge - 24));
      const left = Math.max(leftEdge + 12, Math.min(rect.left + 30, right - width - 12));
      const maxHeight = Math.max(0, Math.min(330, rect.top - topEdge - 16));
      node.style.left = `${left}px`;
      node.style.width = `${width}px`;
      node.style.maxHeight = `${maxHeight}px`;
      node.style.bottom = `${innerHeight - rect.top + 8}px`;
      node.dataset.positioned = "true";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    if (pane) observer.observe(pane);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchor, open]);
  return popup;
}
