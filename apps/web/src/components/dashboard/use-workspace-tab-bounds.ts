import { useLayoutEffect, useState, type RefObject } from "react";

type Bounds = { left: number; width: number };
/** Match the real resizable pane, retaining navigation and existing pane controls. */
export function useWorkspaceTabBounds(
  anchor: RefObject<HTMLDivElement | null>,
  right: RefObject<HTMLElement | null>,
) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  useLayoutEffect(() => {
    const pane = right.current;
    const toolbar = anchor.current?.closest<HTMLElement>('[data-cx="toolbar"]');
    if (!pane || !toolbar) return undefined;
    const navigation = toolbar.querySelector<HTMLElement>('[data-cx="toolbar-navigation"]');
    const actions = toolbar.querySelector<HTMLElement>('[data-cx="toolbar-actions"]');
    const read = () => {
      const panel = pane.getBoundingClientRect();
      const header = toolbar.getBoundingClientRect();
      const left = Math.max(
        panel.left,
        (navigation?.getBoundingClientRect().right ?? header.left) + 8,
      );
      const end = Math.min(
        panel.right,
        (actions?.getBoundingClientRect().left ?? header.right) - 8,
      );
      const next =
        panel.width > 0 && end > left ? { left: left - header.left, width: end - left } : null;
      setBounds((previous) =>
        previous?.left === next?.left && previous?.width === next?.width ? previous : next,
      );
    };
    const observer = new ResizeObserver(read);
    for (const element of [pane, toolbar, navigation, actions])
      if (element) observer.observe(element);
    window.addEventListener("resize", read);
    read();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [anchor, right]);
  return bounds;
}
