/**
 * One decision owner for workspace links, history and signout. The native observer
 * retains one traversal until its expected ACK. Clean/cancelled Profile decisions
 * never execute; a newer admitted route retires the former decision synchronously.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { currentHistoryIndex } from "@/lib/history-position";
import { registerLeaveGuard, type DeferredLeave, type LeaveIntent } from "./account-leave-guard";
import {
  observeNavigation,
  type OwnedTraversal,
  type QueuedLeave,
} from "./profile-history-restore";
import { captureFocus, restoreFocus as focusIfPossible } from "./profile-focus";

export function useUnsavedGuard(
  dirty: boolean,
  restoreRootRef: RefObject<HTMLElement | null>,
  enabled = true,
  warn = dirty,
  blocks: (intent: LeaveIntent) => boolean = () => true,
) {
  const [pending, setPending] = useState<DeferredLeave | null>(null);
  const [lastDirty, setLastDirty] = useState(dirty);
  if (lastDirty !== dirty) {
    setLastDirty(dirty);
    if (!dirty) setPending(null);
  }
  /** Mirrors the visible decision so the stable close callback can check ownership. */
  const pendingRef = useRef<DeferredLeave | null>(null);
  /** Latest intent retained while a restoration is outstanding. */
  const queued = useRef<QueuedLeave | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const atIndex = useRef(currentHistoryIndex());
  const owned = useRef<OwnedTraversal | null>(null);
  const dirtyRef = useRef(dirty);
  const warnRef = useRef(warn);
  const blocksRef = useRef(blocks);
  const mounted = useRef(true);

  useLayoutEffect(() => {
    warnRef.current = warn;
    blocksRef.current = blocks;
  }, [warn, blocks]);

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

  const retireDecision = useCallback(() => {
    queued.current = null;
    setDecision(null);
  }, [setDecision]);
  const isCurrent = useCallback(
    (decision: DeferredLeave) =>
      mounted.current &&
      owned.current === null &&
      queued.current === null &&
      pendingRef.current === decision,
    [],
  );

  /** Keep the latest admission distinct from an old blocked Profile request. */
  const defer = useCallback(
    (intent: LeaveIntent, action: () => void) => {
      rememberFocus();
      const next = { intent, action, retained: !dirtyRef.current || !blocksRef.current(intent) };
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
  useEffect(() => {
    if (!enabled) return undefined;
    if (owned.current === null) atIndex.current = currentHistoryIndex();
    return observeNavigation({
      owned,
      atIndex,
      queued,
      dirty: (intent) => dirtyRef.current && (intent === undefined || blocksRef.current(intent)),
      warn: () => warnRef.current,
      defer,
      setDecision,
      retireDecision,
    });
  }, [defer, setDecision, retireDecision, enabled]);

  // Keep the gate alive through restoration, even if publication makes it clean.
  useEffect(
    () =>
      enabled
        ? registerLeaveGuard((leave) => {
            if (owned.current === null && (!dirtyRef.current || !blocksRef.current(leave.intent))) {
              retireDecision();
              return true;
            }
            defer(leave.intent, () => {
              if (leave.intent.kind !== "route") {
                leave.action();
                return;
              }
              if (owned.current !== null) return;
              const from = currentHistoryIndex();
              // Authorize only this synchronous programmatic push, not arbitrary later navigation.
              owned.current = { from, to: from + 1 };
              try {
                leave.action();
              } finally {
                if (currentHistoryIndex() === from) owned.current = null;
              }
            });
            return false;
          })
        : undefined,
    [defer, retireDecision, enabled],
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
  return { pending: dirty ? pending : null, keepEditing, discard, cancelPending, isCurrent };
}
