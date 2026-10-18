/**
 * Dirty-navigation guard for the Profile form.
 *
 * Anchor clicks, browser back/forward and sign-out funnel into one dialog instead of
 * discarding a dirty draft. Navigation interception lives in `profile-history-restore`
 * and keeps one outstanding native traversal until its expected entry acknowledges
 * it. This hook owns the resulting decision lifecycle: while a restoration is
 * outstanding the latest intent is retained instead of shown or executed, the visible
 * decision is promoted only after acknowledgement and only while the draft is dirty,
 * and closing without navigating restores focus without ever running a deferred
 * action. The StrictMode-safe mounted flag and the commit-synchronous dirty mirror are
 * preserved.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { currentHistoryIndex } from "@/lib/history-position";
import { registerLeaveGuard, type DeferredLeave, type LeaveIntent } from "./account-leave-guard";
import { observeNavigation, type OwnedTraversal } from "./profile-history-restore";
import { captureFocus, restoreFocus as focusIfPossible } from "./profile-focus";

export function useUnsavedGuard(dirty: boolean, restoreRootRef: RefObject<HTMLElement | null>) {
  const [pending, setPending] = useState<DeferredLeave | null>(null);
  const [lastDirty, setLastDirty] = useState(dirty);
  if (lastDirty !== dirty) {
    setLastDirty(dirty);
    if (!dirty) setPending(null);
  }
  /** Mirrors the visible decision so the stable close callback can check ownership. */
  const pendingRef = useRef<DeferredLeave | null>(null);
  /** Latest intent retained while a restoration is outstanding. */
  const queued = useRef<DeferredLeave | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const atIndex = useRef(currentHistoryIndex());
  const owned = useRef<OwnedTraversal | null>(null);
  const dirtyRef = useRef(dirty);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const rememberFocus = useCallback(() => {
    returnFocus.current = captureFocus();
  }, []);

  const restoreFocus = useCallback(() => {
    focusIfPossible(returnFocus.current, restoreRootRef.current);
  }, [restoreRootRef]);

  // Retire authorization on every committed clean transition, including Review
  // latest. Ref/focus cleanup is commit-owned; pending state resets during render.
  useLayoutEffect(() => {
    const becameClean = dirtyRef.current && !dirty;
    dirtyRef.current = dirty;
    if (!becameClean) return;
    const hadDecision = pendingRef.current !== null || queued.current !== null;
    pendingRef.current = null;
    queued.current = null;
    if (hadDecision) restoreFocus();
  }, [dirty, restoreFocus]);

  const setDecision = useCallback((next: DeferredLeave | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  /**
   * A decision is only visible once no guard-issued traversal is outstanding; while
   * one is, the latest intent is retained instead of being shown or executed.
   */
  const defer = useCallback(
    (intent: LeaveIntent, action: () => void) => {
      rememberFocus();
      const next = { intent, action };
      if (owned.current !== null) {
        queued.current = next;
        setDecision(null);
        return;
      }
      queued.current = null;
      setDecision(next);
    },
    [rememberFocus, setDecision],
  );

  // Native history, link interception and the native unload warning. The observer
  // outlives the dirty-only listeners, so a late compensation is still acknowledged.
  useEffect(
    () =>
      observeNavigation({
        owned,
        atIndex,
        queued,
        dirty: () => dirtyRef.current,
        defer,
        setDecision,
      }),
    [defer, setDecision],
  );

  // Keep the gate alive through restoration, even if publication makes it clean.
  useEffect(
    () =>
      registerLeaveGuard((leave) => {
        if (!dirtyRef.current && owned.current === null) return true;
        defer(leave.intent, leave.action);
        return false;
      }),
    [defer],
  );

  const keepEditing = () => {
    if (!mounted.current) return;
    queued.current = null;
    setDecision(null);
    restoreFocus();
  };

  /**
   * Runs the deferred transition, and only from a restored entry. A null
   * `onDiscarded` means leaving is not permitted right now, so the dialog closes and
   * the user stays on the form with no route, sign-out, stage or draft touched.
   */
  const discard = (onDiscarded: (() => void) | null) => {
    if (!mounted.current || owned.current !== null) return;
    const deferred = pendingRef.current;
    setDecision(null);
    if (onDiscarded === null) return;
    onDiscarded();
    deferred?.action();
  };

  /**
   * Drops a deferred decision without running it (a publication settled) and restores
   * focus only if a decision was actually owned. The outstanding native traversal and
   * the observer are never touched.
   */
  const cancelPending = useCallback(() => {
    if (!mounted.current) return;
    const hadDecision = pendingRef.current !== null || queued.current !== null;
    queued.current = null;
    setDecision(null);
    if (hadDecision) restoreFocus();
  }, [restoreFocus, setDecision]);

  // A clean draft owns no decision; the observer and any outstanding native command
  // are untouched by this derivation.
  return { pending: dirty ? pending : null, keepEditing, discard, cancelPending };
}
