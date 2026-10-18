/**
 * Account theme state machine.
 *
 * One generation counter fences every read and write, so an older response never
 * overwrites a newer confirmed revision or clears a newer in-flight attempt.
 * Conflict and uncertain-outcome handling lives in `theme-attempts`; a migration
 * candidate survives a failed write until it is confirmed or outranked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountThemeView } from "@/lib/account-api";
import { ACCOUNT_THEME_INVALIDATE } from "./account-invalidate";
import {
  chooseTheme,
  drainAfterMutation,
  loadAccountTheme,
  retryThemeDecision,
  runThemeWrite,
  type ThemeDecisionPorts,
} from "./theme-attempts";
import type {
  AttemptAccess,
  AttemptKind,
  InitializationPhase,
  ThemeWriteGate,
} from "./theme-access";
import { DEFAULT_THEME, rememberBrowserTheme, type DashboardTheme } from "./theme-storage";

export type AccountThemeState = {
  /** Effective preview theme; confirmed values come from the account. */
  readonly theme: DashboardTheme;
  readonly persisted: boolean;
  readonly note: string | null;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly setTheme: (theme: DashboardTheme) => void;
  readonly retry: () => void;
};

export function useAccountTheme(userId: string): AccountThemeState {
  const [theme, setPreview] = useState<DashboardTheme>(DEFAULT_THEME);
  const [persisted, setPersisted] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmed = useRef<DashboardTheme>(DEFAULT_THEME);
  const revision = useRef(0);
  const generation = useRef(0);
  const inFlight = useRef<AttemptKind | null>(null);
  const desired = useRef<DashboardTheme | null>(null);
  /** A refresh asked for while a mutation was in flight; one trailing read drains it. */
  const refreshPending = useRef(false);
  /** Owned-mutation depth; while above zero reads must not take the generation. */
  const mutating = useRef(0);
  const migration = useRef<{ theme: DashboardTheme; actionId: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stale = useCallback(
    (token: number): boolean => !mounted.current || token !== generation.current,
    [],
  );

  const begin = useCallback((kind: AttemptKind): number => {
    generation.current += 1;
    inFlight.current = kind;
    return generation.current;
  }, []);

  const adopt = useCallback(
    (view: AccountThemeView, token: number): boolean => {
      if (stale(token) || view.revision < revision.current) return false;
      confirmed.current = view.theme;
      revision.current = view.revision;
      setPreview(view.theme);
      setPersisted(true);
      if (view.source === "account" || view.revision > 0) {
        rememberBrowserTheme(userId, view.theme);
        migration.current = null;
      }
      return true;
    },
    [stale, userId],
  );

  const fail = useCallback((message: string) => {
    setFailed(true);
    setNote(message);
    setPreview(confirmed.current);
  }, []);

  const settled = useCallback(
    (token: number, kind: AttemptKind) => {
      if (stale(token)) return;
      if (inFlight.current === kind) inFlight.current = null;
      setPending(false);
    },
    [stale],
  );

  const access = useMemo<AttemptAccess>(
    () => ({
      begin,
      stale,
      settled,
      adopt,
      fail,
      revision,
      desired,
      migration,
      clearNote: () => {
        setFailed(false);
        setNote(null);
      },
      startPending: () => {
        setPending(true);
        setFailed(false);
        setNote(null);
      },
    }),
    [adopt, begin, fail, settled, stale],
  );

  const initialization = useRef<InitializationPhase>("undecided");
  const initialPending = useRef(false);
  const gate = useMemo<ThemeWriteGate>(
    () => ({ mutating, refreshPending, initialization, initialPending }),
    [],
  );

  /**
   * First load: the only read that may persist a pending browser migration
   * candidate, owned by the coordinator's initialization phase.
   */
  const load = useCallback(
    () => loadAccountTheme(access, userId, gate, "initial"),
    [access, gate, userId],
  );

  /**
   * Routine reconciliation used by visibility, online and chat-settlement events:
   * it coalesces behind initialization, never migrates and never clears an
   * unresolved retry intent.
   */
  const refresh = useCallback(
    () => loadAccountTheme(access, userId, gate, "routine"),
    [access, gate, userId],
  );

  const write = useCallback(
    (next: DashboardTheme, actionId: string, retain: "desired" | "migration" | "none") =>
      runThemeWrite(access, userId, next, actionId, retain, gate, drainAfterMutation),
    [access, gate, userId],
  );

  const ports = useMemo<ThemeDecisionPorts>(
    () => ({ access, gate, userId, preview: setPreview, hideFeedback: () => setNote(null), write }),
    [access, gate, userId, write],
  );

  const setTheme = useCallback((next: DashboardTheme) => chooseTheme(ports, next), [ports]);
  const retry = useCallback(() => retryThemeDecision(ports), [ports]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onInvalidate = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(ACCOUNT_THEME_INVALIDATE, onInvalidate);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(ACCOUNT_THEME_INVALIDATE, onInvalidate);
    };
  }, [refresh]);

  return { theme, persisted, note, pending, failed, setTheme, retry };
}
