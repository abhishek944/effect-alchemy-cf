/**
 * Theme reads and the one-time initialization decision.
 *
 * Ordinary reads never race an owned mutation: while `gate.mutating` is set they
 * record refresh debt and return. The first-load initialization is owned by the
 * coordinator's own phase, not by a read generation, so a routine refresh cannot
 * strand it: routine reads coalesce while it is reading, an eligible result settles
 * the decision *before* its write is issued, a failed read returns it to undecided
 * with the visible failure note, and one explicit Retry completes it rather than
 * merely rediscovering the candidate. Manual selection and authoritative account
 * state supersede the obligation and its candidate.
 */
import { errorMessage, getAccountTheme } from "@/lib/account-api";
import type { AttemptAccess, Retain, ThemeWriteGate } from "./theme-access";
import { runThemeWrite, type RefreshDrain } from "./theme-write";
import { readBrowserTheme, type DashboardTheme } from "./theme-storage";

export type { AttemptOutcome } from "./theme-write";
export { runThemeWrite } from "./theme-write";
export type { AttemptAccess, AttemptKind, Retain, ThemeWriteGate } from "./theme-access";

export type ReadIntent = "initial" | "routine";

/**
 * One read after an owned mutation settles: an initialization request queued behind
 * it is completed once, otherwise routine reconciliation runs. A read that cannot
 * confirm the write keeps the unresolved failure and its Retry visible.
 */
export const drainAfterMutation: RefreshDrain = async (access, userId, gate, confirmed) => {
  if (gate.mutating.current > 0) return;
  gate.refreshPending.current = false;
  const initial = gate.initialPending.current && gate.initialization.current === "undecided";
  gate.initialPending.current = false;
  await loadAccountTheme(access, userId, gate, initial ? "initial" : "routine", !confirmed);
};

/** Explicit Retry with nothing retained: finish the undecided initialization, else refresh. */
export const retryRead = (access: AttemptAccess, userId: string, gate: ThemeWriteGate): void => {
  const intent = gate.initialization.current === "undecided" ? "initial" : "routine";
  void loadAccountTheme(access, userId, gate, intent);
};

/** Manual selection or authoritative account state retires the obligation and candidate. */
export const supersedeInitialization = (
  access: AttemptAccess,
  gate: ThemeWriteGate,
  clearCandidate: boolean,
): void => {
  gate.initialization.current = "settled";
  gate.initialPending.current = false;
  if (clearCandidate) access.migration.current = null;
};

/**
 * One authoritative read. A read never starts while a mutation owns the
 * generation: it coalesces into one trailing refresh instead. The browser
 * migration candidate is read *before* adopting, because adopting an account value
 * rewrites the mirror, and the candidate is then persisted through the same
 * sequenced write path.
 */
export const loadAccountTheme = async (
  access: AttemptAccess,
  userId: string,
  gate: ThemeWriteGate,
  intent: ReadIntent,
  /** True when the caller must not clear an unresolved failure and its Retry. */
  keepFailure = false,
): Promise<void> => {
  const initial = intent === "initial";
  if (initial && gate.initialization.current !== "undecided") return;
  if (gate.mutating.current > 0) {
    gate.refreshPending.current = true;
    if (initial) gate.initialPending.current = true;
    return;
  }
  if (!initial && gate.initialization.current === "reading") {
    // Coalesce: a routine read must not steal the initialization generation.
    gate.refreshPending.current = true;
    return;
  }
  if (initial) gate.initialization.current = "reading";
  const token = access.begin("read");
  try {
    const view = await getAccountTheme();
    if (access.stale(token)) return;
    const eligible = view.source === "default" && view.revision === 0;
    const canInitialize = eligible && gate.initialization.current !== "settled";
    const browser =
      canInitialize && access.migration.current === null ? readBrowserTheme(userId) : null;
    if (browser !== null)
      access.migration.current = { theme: browser, actionId: `migrate:${crypto.randomUUID()}` };
    const accountOwns = view.source === "account" || view.revision > 0;
    // An unattempted initialization is completed by this first authoritative result,
    // whichever read produced it, exactly once.
    const completesInitialization = !accountOwns && gate.initialization.current !== "settled";
    access.adopt(view, token);
    if (accountOwns) supersedeInitialization(access, gate, true);
    const candidate = completesInitialization ? access.migration.current : null;
    if (completesInitialization) {
      // Settle before feedback and before writes: recovered reads stop reporting
      // their old error, but failed migration writes cannot be replayed by a read.
      gate.initialization.current = "settled";
      gate.initialPending.current = false;
    }
    const unresolved = access.desired.current !== null || access.migration.current !== null;
    if (!keepFailure && !(intent === "routine" && unresolved)) access.clearNote();
    if (candidate !== null) {
      access.settled(token, "read");
      await runThemeWrite(
        access,
        userId,
        candidate.theme,
        candidate.actionId,
        "migration",
        gate,
        drainAfterMutation,
      );
      return;
    }
    if (gate.refreshPending.current && gate.initialization.current !== "reading") {
      access.settled(token, "read");
      await drainAfterMutation(access, userId, gate, true);
      return;
    }
  } catch (cause) {
    if (!access.stale(token)) {
      if (initial) gate.initialization.current = "undecided";
      access.fail(`${errorMessage(cause)} This browser shows your choice until it can be saved.`);
    }
  } finally {
    access.settled(token, "read");
  }
};

/** What a user decision needs from the provider; keeps ownership in this module. */
export type ThemeDecisionPorts = {
  readonly access: AttemptAccess;
  readonly gate: ThemeWriteGate;
  readonly userId: string;
  readonly preview: (theme: DashboardTheme) => void;
  readonly hideFeedback: () => void;
  readonly write: (theme: DashboardTheme, actionId: string, retain: Retain) => Promise<unknown>;
};

/** A manual selection: preview it, supersede initialization, then issue one write. */
export const chooseTheme = (ports: ThemeDecisionPorts, next: DashboardTheme): void => {
  ports.preview(next);
  ports.hideFeedback();
  supersedeInitialization(ports.access, ports.gate, true);
  ports.access.desired.current = next;
  void ports.write(next, `manual:${crypto.randomUUID()}`, "desired");
};

/** Explicit Retry: preview the retained target, else finish the undecided initialization. */
export const retryThemeDecision = (ports: ThemeDecisionPorts): void => {
  const target = ports.access.desired.current;
  if (target !== null) {
    ports.preview(target);
    ports.hideFeedback();
    void ports.write(target, `manual:${crypto.randomUUID()}`, "desired");
    return;
  }
  const candidate = ports.access.migration.current;
  if (candidate !== null) {
    ports.preview(candidate.theme);
    ports.hideFeedback();
    void ports.write(candidate.theme, candidate.actionId, "migration");
    return;
  }
  retryRead(ports.access, ports.userId, ports.gate);
};
