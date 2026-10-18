/**
 * Owned theme mutations: one guarded write, its recovery, and the single trailing
 * read that drains coalesced refresh debt after the mutation has fully settled.
 */
import { errorMessage, writeAccountTheme } from "@/lib/account-api";
import { ChatApiError } from "@/lib/chat-api";
import type { AttemptAccess, Retain, ThemeWriteGate } from "./theme-access";
import { revalidateTheme } from "./theme-recovery";
import type { DashboardTheme } from "./theme-storage";

export type AttemptOutcome = { readonly confirmed: boolean };

/**
 * Supplied by the coordinator so this module never imports the read path (which
 * imports it back). `confirmed` keeps an unresolved failure and its Retry visible.
 */
export type RefreshDrain = (
  access: AttemptAccess,
  userId: string,
  gate: ThemeWriteGate,
  confirmed: boolean,
) => Promise<void>;

/** One guarded write; a rejected choice is kept only for an explicit Retry. */
const writeThemeAttempt = async (
  access: AttemptAccess,
  next: DashboardTheme,
  actionId: string,
  retain: Retain,
): Promise<AttemptOutcome> => {
  const token = access.begin("write");
  access.startPending();
  try {
    const saved = await writeAccountTheme(access.revision.current, next, actionId);
    if (access.stale(token)) return { confirmed: false };
    access.desired.current = null;
    access.migration.current = null;
    access.adopt(saved, token);
    access.settled(token, "write");
    return { confirmed: true };
  } catch (cause) {
    if (access.stale(token)) return { confirmed: false };
    const conflict = cause instanceof ChatApiError && cause.status === 409;
    access.settled(token, "write");
    const confirmed = await revalidateTheme(
      access,
      conflict
        ? "Theme changed elsewhere. Showing the saved theme."
        : `${errorMessage(cause)} I could not confirm whether that change was saved.`,
      next,
      retain,
      conflict ? "refused" : "uncertain",
    );
    return { confirmed };
  }
};

/**
 * One owned mutation plus its single trailing refresh. `curated` is the attempt
 * logic itself so the migration path uses the same sequencing as manual writes.
 */
export const runThemeWrite = async (
  access: AttemptAccess,
  userId: string,
  next: DashboardTheme,
  actionId: string,
  retain: Retain,
  gate: ThemeWriteGate,
  drain: RefreshDrain,
): Promise<AttemptOutcome> => {
  gate.mutating.current += 1;
  let outcome: AttemptOutcome = { confirmed: false };
  try {
    outcome = await writeThemeAttempt(access, next, actionId, retain);
  } finally {
    gate.mutating.current -= 1;
  }
  // Another mutation owns the generation: it performs the single trailing read.
  if (gate.mutating.current > 0) {
    gate.refreshPending.current = true;
    return outcome;
  }
  if (!gate.refreshPending.current) return outcome;
  // Drain after settlement only, through the coordinator so an initialization
  // request queued behind the mutation is completed exactly once.
  await drain(access, userId, gate, outcome.confirmed);
  return outcome;
};
