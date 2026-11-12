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
      // Keep the normal viewport padding when it fits; decorative padding must
      // yield before the editor/actions/ledger need outer-footer scrolling.
      const viewportStyle = viewport ? getComputedStyle(viewport) : null;
      const padding = viewportStyle
        ? pixels(viewportStyle.getPropertyValue("--chat-viewport-padding-block")) * 2
        : 0;
      const shell = footer.querySelector('[data-cx="composer-shell"]');
      if (shell) next.add(shell);
      const lane = footer.querySelector('[data-cx="chat-notice-lane"]');
      const content = lane?.querySelector('[data-cx="chat-notice-content"]');
      if (lane) next.add(lane);
      if (content) next.add(content);
      const footerStyle = getComputedStyle(footer);
      let fixed = pixels(footerStyle.paddingTop) + pixels(footerStyle.paddingBottom);
      for (const child of footer.children) {
        if (child !== lane) fixed += outerHeight(child);
      }
      // Reserve one quiet line even when chrome alone exceeds the available
      // height; in that case the existing outer footer scrolls every control.
      const reservation =
        lane && content
          ? pixels(getComputedStyle(content).minHeight) +
            pixels(getComputedStyle(lane).paddingBottom)
          : 0;
      const available = Math.max(0, thread.clientHeight - occupied);
      const fittedPadding = Math.min(padding, Math.max(0, available - fixed - reservation));
      if (viewport instanceof HTMLElement)
        viewport.style.setProperty("--chat-viewport-padding-budget", `${fittedPadding / 2}px`);
      const room = Math.max(0, available - fittedPadding);
      footer.style.setProperty("--chat-footer-budget", `${room}px`);
      footer.style.setProperty("--chat-notice-budget", `${Math.max(reservation, room - fixed)}px`);
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
      // Notices may take viewport space, not change the same draft/file budget.
      fixed += reservation - list.getBoundingClientRect().height;
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
    changes.observe(footer, { childList: true, subtree: true, characterData: true });
    update();
    return () => {
      resize.disconnect();
      changes.disconnect();
      cancelAnimationFrame(frame);
      footer.style.removeProperty("--chat-footer-budget");
      footer.style.removeProperty("--chat-file-budget");
      footer.style.removeProperty("--chat-notice-budget");
      thread
        .querySelector<HTMLElement>('[data-cx="chat-viewport"]')
        ?.style.removeProperty("--chat-viewport-padding-budget");
    };
  }, [ref]);
}
