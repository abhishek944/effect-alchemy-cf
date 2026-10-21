import { useRef } from "react";

export type ReviewTab = "result" | "changes" | "preview";
const tabs: readonly ReviewTab[] = ["result", "changes", "preview"];
export function ReviewTabs({
  id,
  tab,
  total,
  onChange,
}: {
  readonly id: string;
  readonly tab: ReviewTab;
  readonly total: number | undefined;
  readonly onChange: (value: ReviewTab) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const labels = {
    result: "Full result",
    changes: `Exact changes${total === undefined ? "" : ` (${total})`}`,
    preview: "Merge preview",
  };
  const select = (value: ReviewTab) => {
    onChange(value);
    list.current?.querySelector<HTMLButtonElement>(`[data-office-tab="${value}"]`)?.focus();
  };
  return (
    <div ref={list} data-office="review-tabs" role="tablist" aria-label="Review views">
      {tabs.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`office-tab-${id}-${value}`}
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          data-office-tab={value}
          aria-controls={`office-review-${id}`}
          onClick={() => select(value)}
          onKeyDown={(event) => {
            const index = tabs.indexOf(value);
            const next =
              event.key === "ArrowRight"
                ? tabs[(index + 1) % tabs.length]
                : event.key === "ArrowLeft"
                  ? tabs[(index + tabs.length - 1) % tabs.length]
                  : event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                      ? tabs[2]
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              select(next);
            }
          }}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );
}
