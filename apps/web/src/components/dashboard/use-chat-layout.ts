import { useLayoutEffect, type RefObject } from "react";

const pixels = (value: string): number => Number.parseFloat(value) || 0;
const outerHeight = (element: Element): number => {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.position === "absolute" || style.position === "fixed")
    return 0;
  return (
    element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom)
  );
};

/** Budget the existing file scroller after measured fixed controls, never a guessed conversation floor. */
export function useChatLayout(ref: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const footer = ref.current;
    const thread = footer?.closest('[data-cx="chat-thread"]');
    if (!footer || !thread) return undefined;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    const observed = new Set<Element>();
    const update = () => {
      frame = 0;
      if (!thread.clientHeight) return;
      const viewport = thread.querySelector('[data-cx="chat-viewport"]');
      let occupied = 0;
      const next = new Set<Element>([thread, footer]);
      for (const child of thread.children) {
        if (child === footer || child === viewport) continue;
        occupied += outerHeight(child);
        next.add(child);
      }
      // Preserve the viewport's actual padding, not a new product minimum.
      const viewportStyle = viewport ? getComputedStyle(viewport) : null;
      const padding = viewportStyle
        ? pixels(viewportStyle.paddingTop) + pixels(viewportStyle.paddingBottom)
        : 0;
      const room = Math.max(0, thread.clientHeight - occupied - padding);
      footer.style.setProperty("--chat-footer-budget", `${room}px`);
      const shell = footer.querySelector('[data-cx="composer-shell"]');
      if (shell) next.add(shell);
      const list = footer.querySelector('[data-cx="file-list"]');
      let row = 0;
      for (const child of list?.children ?? []) {
        next.add(child);
        row = Math.max(row, child.getBoundingClientRect().height);
      }
      for (const element of observed) {
        if (!next.has(element)) {
          resize.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of next) {
        if (!observed.has(element)) {
          resize.observe(element);
          observed.add(element);
        }
      }
      if (!list) {
        footer.style.removeProperty("--chat-file-budget");
        return;
      }
      const style = getComputedStyle(footer);
      let fixed = pixels(style.paddingTop) + pixels(style.paddingBottom);
      for (const child of footer.children) fixed += outerHeight(child);
      fixed -= list.getBoundingClientRect().height;
      // Every row is observed; wrapped upload/status changes preserve the
      // largest complete-row minimum without watching the streamed timeline.
      // A complete row remains scrollable. If even fixed chrome cannot fit,
      // the bounded footer itself scrolls instead of losing input or Stop.
      footer.style.setProperty(
        "--chat-file-budget",
        `${Math.max(row, Math.floor(room - fixed))}px`,
      );
    };
    resize.observe(thread);
    resize.observe(footer);
    observed.add(thread);
    observed.add(footer);
    const changes = new MutationObserver(schedule);
    changes.observe(thread, { childList: true });
    changes.observe(footer, { childList: true, subtree: true });
    update();
    return () => {
      resize.disconnect();
      changes.disconnect();
      cancelAnimationFrame(frame);
      footer.style.removeProperty("--chat-footer-budget");
      footer.style.removeProperty("--chat-file-budget");
    };
  }, [ref]);
}
