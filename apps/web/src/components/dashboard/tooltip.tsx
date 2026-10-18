import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export default function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "right";
}) {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = !dismissed && (hovered || focused);

  useLayoutEffect(() => {
    const tip = bubble.current;
    const anchor = wrapper.current;
    if (!tip || !anchor || !visible || !label || typeof tip.showPopover !== "function")
      return undefined;
    // A native popover stays in the DOM for inherited tokens but escapes ancestor clipping.
    tip.showPopover();
    const bounds = anchor.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    let placement: "bottom" | "top" | "right" | "left" = side;
    let x = bounds.left + (bounds.width - size.width) / 2;
    let y = bounds.bottom + 8;
    if (side === "right") {
      x = bounds.right + 8;
      y = bounds.top + (bounds.height - size.height) / 2;
      if (x + size.width > window.innerWidth - 8) {
        placement = "left";
        x = bounds.left - size.width - 8;
      }
    } else if (y + size.height > window.innerHeight - 8) {
      placement = "top";
      y = bounds.top - size.height - 8;
    }
    tip.dataset.placement = placement;
    tip.style.left = `${Math.max(8, Math.min(x, window.innerWidth - size.width - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(y, window.innerHeight - size.height - 8))}px`;
    const dismiss = () => setDismissed(true);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && tip.contains(event.target))) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", escape);
      if (tip.matches(":popover-open")) tip.hidePopover();
    };
  }, [label, side, visible]);

  const trigger = isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
      })
    : children;

  return (
    <span
      ref={wrapper}
      data-cx="tooltip-wrap"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => {
        setFocused(true);
        setDismissed(false);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onClickCapture={() => setDismissed(true)}
    >
      {trigger}
      <span ref={bubble} id={id} data-cx="tooltip" role="tooltip" popover="manual">
        <span data-cx="tooltip-text">{label}</span>
      </span>
    </span>
  );
}
