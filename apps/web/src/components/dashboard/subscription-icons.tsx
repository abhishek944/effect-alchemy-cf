// Lucide 1.53.0 paths at the approved 24x24 viewBox and 1.75 stroke.
import type { ReactNode } from "react";

export type SubscriptionFeatureIcon =
  | "chat"
  | "history"
  | "search"
  | "check"
  | "file"
  | "image"
  | "mic"
  | "sparkle";

const icons: Record<SubscriptionFeatureIcon, ReactNode> = {
  chat: <path d="M21 11a9 9 0 0 1-9 9H4l-3 2 1-7a9 9 0 1 1 19-4Z" />,
  history: <path d="M3 11a9 9 0 1 1 2.8 7M3 3v8h8M12 7v5l3 2" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m21 15-5-5L6 21" />
    </>
  ),
  mic: (
    <>
      <path d="M12 19v3M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="12" rx="3" />
    </>
  ),
  sparkle: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />,
};

export function SubscriptionIcon({
  name,
  className,
}: {
  name: SubscriptionFeatureIcon;
  className?: string;
}) {
  return (
    <svg
      className={className}
      data-cx="subscription-icon"
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}
