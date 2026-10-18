/**
 * Native history and link interception for the leave guard.
 *
 * The guard issues at most one relative traversal at a time. Only the event landing
 * on its expected entry index acknowledges it; a mismatched event never clears that
 * command and never issues a second relative `go`, and the requested destination is
 * coalesced instead. Decisions are therefore only offered (or executed) after the
 * restoration is acknowledged. Anchor clicks are intercepted in the capture phase so
 * a dirty draft never navigates before the user explicitly discards it, and closing
 * or reloading the tab still uses the browser's native warning.
 */
import type { MutableRefObject } from "react";
import { currentHistoryIndex, traverseHistory } from "@/lib/history-position";
import { navigate, registerPopStateGuard } from "@/lib/router";
import type { DeferredLeave, LeaveIntent } from "./account-leave-guard";

/** A traversal the guard issued; only the matching destination index may consume it. */
export type OwnedTraversal = { readonly from: number; readonly to: number };

export type NavigationGuardPorts = {
  readonly owned: MutableRefObject<OwnedTraversal | null>;
  readonly atIndex: MutableRefObject<number>;
  /** Latest intent retained while a restoration is outstanding. */
  readonly queued: MutableRefObject<DeferredLeave | null>;
  readonly dirty: () => boolean;
  readonly defer: (intent: LeaveIntent, action: () => void) => void;
  readonly setDecision: (next: DeferredLeave | null) => void;
};

/** Installs the interception listeners and returns their cleanup. */
export const observeNavigation = (ports: NavigationGuardPorts): (() => void) => {
  const { owned, atIndex, queued, setDecision } = ports;

  const promote = () => {
    const next = queued.current;
    queued.current = null;
    if (next === null || !ports.dirty()) {
      setDecision(null);
      return;
    }
    setDecision(next);
  };

  const deferHistory = (index: number, path: string) => {
    ports.defer({ kind: "route", path, via: "history" }, () => {
      if (owned.current !== null) return;
      const delta = index - atIndex.current;
      if (delta === 0) return;
      owned.current = { from: atIndex.current, to: index };
      traverseHistory(delta);
    });
  };

  const onPopState = (event: PopStateEvent): boolean => {
    const index = currentHistoryIndex();
    const outstanding = owned.current;
    if (outstanding !== null && index === outstanding.to) {
      owned.current = null;
      atIndex.current = index;
      promote();
      return true;
    }
    const path = `${window.location.pathname}${window.location.search}`;
    if (outstanding !== null) {
      // Keep observing the issued command even if the form became clean.
      event.stopImmediatePropagation();
      deferHistory(index, path);
      return false;
    }
    if (!ports.dirty()) {
      atIndex.current = index;
      return true;
    }
    event.stopImmediatePropagation();
    const delta = atIndex.current - index;
    if (delta === 0) {
      deferHistory(index, path);
      return false;
    }
    owned.current = { from: index, to: atIndex.current };
    // Capture the original request and focus before restoration; defer sees the
    // owned command, suppresses old decisions and promotes only after its ack.
    deferHistory(index, path);
    traverseHistory(delta);
    return false;
  };

  const onClick = (event: MouseEvent) => {
    if (!ports.dirty() && owned.current === null) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (href === `${window.location.pathname}${window.location.search}`) return;
    event.preventDefault();
    event.stopPropagation();
    ports.defer({ kind: "route", path: href, via: "link" }, () => {
      if (owned.current !== null) return;
      const from = currentHistoryIndex();
      owned.current = { from, to: from + 1 };
      // A same-path navigation issues no traversal, so the authorization is released.
      if (!navigate(href)) owned.current = null;
    });
  };

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!ports.dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  const releasePopStateGuard = registerPopStateGuard(onPopState);
  document.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    releasePopStateGuard();
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
};
