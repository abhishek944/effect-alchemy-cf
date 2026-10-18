import { useEffect, useState } from "react";
import { pushHistoryEntry, replaceHistoryEntry } from "./history-position";

/** Consult policy before React can unmount the form owning a native traversal. */
type PopStateGuard = (event: PopStateEvent) => boolean;
let popStateGuard: PopStateGuard | null = null;
const dispositions = new WeakMap<PopStateEvent, boolean>();

export function registerPopStateGuard(guard: PopStateGuard): () => void {
  popStateGuard = guard;
  return () => {
    if (popStateGuard === guard) popStateGuard = null;
  };
}

const mayPublish = (event: PopStateEvent): boolean => {
  const known = dispositions.get(event);
  if (known !== undefined) return known;
  const allowed = popStateGuard?.(event) ?? true;
  dispositions.set(event, allowed);
  return allowed;
};

/**
 * Minimal history-based navigation so the portal needs no router dependency.
 * Returns false when the current path already matches, so a caller that prepared a
 * history bypass can tell that no traversal was issued.
 */
export function navigate(path: string, options?: { replace?: boolean }): boolean {
  if (window.location.pathname === path) return false;
  if (options?.replace) replaceHistoryEntry(path);
  else pushHistoryEntry(path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return true;
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = (event: PopStateEvent) => {
      if (mayPublish(event)) setPathname(window.location.pathname);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return pathname;
}
