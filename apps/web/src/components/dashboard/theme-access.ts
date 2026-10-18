/**
 * Shared sequencing contracts for account theme attempts.
 *
 * Kept separate from the attempt implementations so the recovery read, the write
 * path and the provider hook can depend on the types without importing each other
 * in a cycle.
 */
import type { MutableRefObject } from "react";
import type { AccountThemeView } from "@/lib/account-api";
import type { DashboardTheme } from "./theme-storage";

export type AttemptKind = "read" | "write" | "migration";
export type Retain = "desired" | "migration" | "none";

/** One-time initialization obligation, independent of ordinary read generations. */
export type InitializationPhase = "undecided" | "reading" | "settled";

/**
 * The single owner of theme sequencing: mutation depth, coalesced refresh debt and
 * the first-load initialization obligation. Callers read this state; they never keep
 * their own copy of it.
 */
export type ThemeWriteGate = {
  /** Depth of owned mutations; while above zero no read may take the generation. */
  readonly mutating: MutableRefObject<number>;
  /** A read was requested during a mutation or an initialization read; drained once. */
  readonly refreshPending: MutableRefObject<boolean>;
  /** Whether the one-time initialization decision is undecided, reading or settled. */
  readonly initialization: MutableRefObject<InitializationPhase>;
  /** An initialization read was requested while a mutation owned the generation. */
  readonly initialPending: MutableRefObject<boolean>;
};

export type AttemptAccess = {
  readonly begin: (kind: AttemptKind) => number;
  readonly stale: (token: number) => boolean;
  readonly settled: (token: number, kind: AttemptKind) => void;
  readonly adopt: (view: AccountThemeView, token: number) => boolean;
  readonly fail: (message: string) => void;
  readonly revision: MutableRefObject<number>;
  readonly desired: MutableRefObject<DashboardTheme | null>;
  readonly migration: MutableRefObject<{ theme: DashboardTheme; actionId: string } | null>;
  readonly clearNote: () => void;
  readonly startPending: () => void;
};
