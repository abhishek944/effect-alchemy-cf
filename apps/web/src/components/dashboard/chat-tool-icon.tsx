// Lucide-style paths match the accepted T3code reference; see LUCIDE-LICENSE.txt.
export type ToolIconName = "tools" | "terminal" | "sheet" | "eye" | "panel";

export function ChatToolIcon({ name }: { name: ToolIconName }) {
  const paths = {
    tools: (
      <>
        <path d="m15 12-8 8-3-3 8-8" />
        <path d="m13 3 8 8-3 3-8-8z" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 8 4 4-4 4m6 0h4" />
      </>
    ),
    sheet: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 12h8m-8 4h8m-4-4v8" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    panel: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M14 3v18" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function ToolChevron() {
  return (
    <svg
      data-cx="tool-chevron"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
