/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus and scroll the horizontal deck. */
import { Children, useRef, useState, type ReactNode } from "react";

type Props = { kind: "workspace" | "workflow"; children: ReactNode };

export default function PublicDeck({ kind, children }: Props) {
  const track = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(1);
  const count = Children.count(children);
  const workspace = kind === "workspace";
  const width = () => (track.current?.firstElementChild?.getBoundingClientRect().width ?? 0) + 18;
  const move = (direction: number) =>
    track.current?.scrollBy({
      left: direction * width(),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  return (
    <>
      <section
        ref={track}
        id={`${kind}-deck`}
        className={workspace ? "pillars" : "story"}
        aria-label={workspace ? "Workspace capabilities" : "Workflow steps"}
        tabIndex={0}
        onScroll={() =>
          setCurrent(Math.min(count, Math.round((track.current?.scrollLeft ?? 0) / width()) + 1))
        }
      >
        {children}
      </section>
      <div className={workspace ? "deck-controls" : "flow-controls"}>
        <button
          type="button"
          aria-controls={`${kind}-deck`}
          aria-label={`Previous ${workspace ? "capability" : "step"}`}
          onClick={() => move(-1)}
        >
          ←
        </button>
        <span aria-live="polite">
          {current} / {count}
        </span>
        <button
          type="button"
          aria-controls={`${kind}-deck`}
          aria-label={`Next ${workspace ? "capability" : "step"}`}
          onClick={() => move(1)}
        >
          →
        </button>
      </div>
    </>
  );
}
