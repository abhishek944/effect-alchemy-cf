import type { AuthMode } from "@/components/auth-form";

type BrowserLocation = Pick<Location, "origin" | "pathname" | "search" | "hash">;
export const isPublicAuthPath = (pathname: string) =>
  pathname === "/login" || pathname === "/signup";

/** Auth navigation stays same-origin and cannot redirect back into an auth-page loop. */
export function authContinuation(location: BrowserLocation): string {
  const requested = isPublicAuthPath(location.pathname)
    ? new URLSearchParams(location.search).get("next")
    : location.pathname + location.search + location.hash;
  if (!requested?.startsWith("/")) return "/dashboard";
  try {
    const url = new URL(requested, location.origin);
    if (url.origin !== location.origin || isPublicAuthPath(url.pathname)) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}

export function authModePath(mode: AuthMode, location: BrowserLocation): string {
  const path = mode === "sign-up" ? "/signup" : "/login";
  const next = authContinuation(location);
  return next === "/dashboard" ? path : `${path}?next=${encodeURIComponent(next)}`;
}
