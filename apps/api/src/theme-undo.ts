/**
 * Origin-scoped Undo for one frozen chat command.
 *
 * Undo restores the exact target this chat previously changed, and only while that
 * target is still the current revision: a newer manual, device or chat change makes
 * it conflict instead of reverting someone else's choice. A consumed pointer cannot
 * be used twice, and every attempt stores its terminal receipt.
 */
import type { AgentContext } from "agents";
import {
  fingerprintOf,
  type AccountTheme,
  type ActionReceipt,
  type FrozenUndo,
  type ThemeOrigin,
  type ThemeResolution,
} from "./theme-model.ts";
import type { ThemeRecord } from "./theme-record.ts";
import type { ThemeReceipts } from "./theme-receipts.ts";

export type UndoResult = { readonly receipt: ActionReceipt; readonly current: AccountTheme };

export const undoThemeCommand = (
  storage: AgentContext["storage"],
  record: ThemeRecord,
  receipts: ThemeReceipts,
  command: FrozenUndo,
  origin: ThemeOrigin,
  now: number,
): ThemeResolution<UndoResult> => {
  return storage.transactionSync(() => {
    const fingerprint = fingerprintOf(command);
    const existing = receipts.get(command.actionId);
    if (existing !== null) {
      if (existing.fingerprint !== fingerprint || existing.origin !== origin)
        return { ok: false, code: "invalid_input" };
      return { ok: true, value: { receipt: existing, current: record.read() } };
    }
    const current = record.read();
    const before = { theme: current.theme, revision: current.revision };
    const target = receipts.get(command.targetActionId);
    const pointer = receipts.target(origin);
    const changed = target !== null && target.result.ok && target.result.changed;
    const pointed = pointer !== null && pointer.targetActionId === command.targetActionId;
    const stillCurrent =
      target !== null &&
      target.result.ok &&
      changed &&
      target.origin === origin &&
      target.result.revision === current.revision &&
      command.expectedRevision === current.revision;
    if (target === null || !changed || target.origin !== origin || !pointed) {
      const receipt: ActionReceipt = {
        actionId: command.actionId,
        fingerprint,
        origin,
        before,
        result: {
          ok: false,
          code: "nothing_to_undo",
          currentTheme: current.theme,
          currentRevision: current.revision,
          message: "There is no theme change from this chat left to undo.",
        },
      };
      receipts.put(receipt, now);
      return { ok: true, value: { receipt, current } };
    }
    if (!stillCurrent) {
      const receipt: ActionReceipt = {
        actionId: command.actionId,
        fingerprint,
        origin,
        before,
        result: {
          ok: false,
          code: "revision_conflict",
          currentTheme: current.theme,
          currentRevision: current.revision,
          message: "A newer theme change replaced that one, so nothing was reverted.",
        },
      };
      receipts.put(receipt, now);
      return { ok: true, value: { receipt, current } };
    }
    const restored: AccountTheme = {
      version: 1,
      revision: current.revision + 1,
      theme: target.before.theme,
      source: "account",
      previous: null,
    };
    record.put(restored);
    receipts.clearTarget(origin);
    const receipt: ActionReceipt = {
      actionId: command.actionId,
      fingerprint,
      origin,
      before,
      result: {
        ok: true,
        code: "saved",
        changed: true,
        theme: restored.theme,
        revision: restored.revision,
      },
    };
    receipts.put(receipt, now);
    return { ok: true, value: { receipt, current: restored } };
  });
};
