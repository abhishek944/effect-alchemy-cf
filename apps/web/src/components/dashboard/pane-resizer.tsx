/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This is an interactive window splitter, not a static hr. */
import { useRef, type PointerEvent } from "react";
import { usePaneGeometry } from "./use-pane-geometry";

type Props = {
  target: string;
  label: string;
  value: number;
  min: number;
  max: number;
  percentage?: boolean;
  onChange: (value: number) => void;
};

export default function PaneResizer({
  target,
  label,
  value,
  min,
  max,
  percentage = false,
  onChange,
}: Props) {
  const drag = useRef<{ pointer: number; x: number; width: number; scale: number } | null>(null);
  const { geometry, rulerRef } = usePaneGeometry({ target, percentage, min, max });
  const reported = geometry ?? { value, min, max };
  const resize = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={rulerRef}
      role="separator"
      data-cx="pane-resizer"
      data-pane={percentage ? "chat" : "sidebar"}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={target}
      aria-valuemin={Math.round(reported.min)}
      aria-valuemax={Math.round(reported.max)}
      aria-valuenow={Math.round(reported.value)}
      aria-valuetext={`${Math.round(reported.value)}${percentage ? " percent" : " pixels"}`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        const pane = document.getElementById(target);
        if (!pane) return;
        event.preventDefault();
        event.currentTarget.focus();
        const scale = percentage ? (pane.parentElement?.clientWidth ?? 100) / 100 : 1;
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          width: pane.getBoundingClientRect().width / scale,
          scale,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.setAttribute("data-dragging", "true");
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointer === event.pointerId)
          resize(start.width + (event.clientX - start.x) / start.scale);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const pane = document.getElementById(target);
        const scale = percentage ? (pane?.parentElement?.clientWidth ?? 100) / 100 : 1;
        const current = pane ? pane.getBoundingClientRect().width / scale : value;
        const step = percentage ? 2 : 16;
        const next =
          event.key === "ArrowLeft"
            ? current - step
            : event.key === "ArrowRight"
              ? current + step
              : event.key === "Home"
                ? min
                : event.key === "End"
                  ? max
                  : null;
        if (next === null) return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
