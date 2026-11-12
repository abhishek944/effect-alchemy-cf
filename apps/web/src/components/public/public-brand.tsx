import RouteLink from "@/lib/route-link";

export const PUBLIC_SITE_NAME = "Personal AI Office";
type Props = {
  /** The brand leaves for the main UI when a separate admin origin renders it. */
  homeHref?: string;
};

export default function PublicBrand({ homeHref = "/" }: Props) {
  return (
    <RouteLink className="brand" href={homeHref} aria-label={`${PUBLIC_SITE_NAME} home`}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <ellipse
          cx="14"
          cy="14"
          rx="5"
          ry="13"
          stroke="currentColor"
          strokeWidth="1.3"
          transform="rotate(42 14 14)"
        />
        <ellipse
          cx="14"
          cy="14"
          rx="5"
          ry="13"
          stroke="currentColor"
          strokeWidth="1.3"
          transform="rotate(-42 14 14)"
        />
      </svg>
      <span>{PUBLIC_SITE_NAME}</span>
    </RouteLink>
  );
}
