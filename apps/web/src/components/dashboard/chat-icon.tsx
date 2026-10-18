// Lucide paths from the project design skill; see LUCIDE-LICENSE.txt.
const paths = {
  plus: <path d="M5 12h14M12 5v14" />,
  "arrow-up": <path d="m5 12 7-7 7 7M12 19V5" />,
  mic: (
    <>
      <path d="M12 19v3M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="12" rx="3" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  check: <path d="m20 6-11 11-5-5" />,
  ellipsis: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  speaker: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
};

export default function ChatIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      data-cx="icon"
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
