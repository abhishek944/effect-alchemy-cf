import { useCallback, type RefObject } from "react";
import type { OfficeSendTarget } from "@starter/office-contract";
import { ACCOUNT_COMMAND, panelKey } from "./workspace-office-scope";

export type OfficePanelGuard = {
  readonly chatId: string;
  readonly owner: object;
  readonly readOnly?: boolean;
  readonly prepareToLeave: () => Promise<void>;
  readonly commitLeave?: () => Promise<void>;
  readonly cancelLeave?: () => Promise<void>;
  readonly prepareSend: () => Promise<OfficeSendTarget | null>;
};
type Options = {
  beginCommand: (scope: string) => (() => void) | null;
  report: (message: string) => void;
  panels: RefObject<Map<string, OfficePanelGuard>>;
  selected: RefObject<{ chatId: string; id: string } | null>;
  visible: RefObject<{ chatId: string | null; showing: boolean }>;
};
const BUSY = "Finish the current Office operation in this chat, then try again.";

/**
 * Destructive Office commands are admitted per panel: one file serializes its own commands while
 * every other file keeps working, and whole-account navigation still conflicts with all of them.
 * Each command waits for its exact guard's save acknowledgement before the tab unmounts.
 */
export function useOfficeBarriers({ beginCommand, report, panels, selected, visible }: Options) {
  const barrier = useCallback(
    async (scope: string, action: () => void | Promise<void>): Promise<boolean> => {
      const release = beginCommand(scope);
      if (release === null) {
        report(BUSY);
        return false;
      }
      report("");
      try {
        await action();
        return true;
      } catch {
        report(
          "Office input or saves are unconfirmed. Tabs stay open. Check the affected editor; saved, paused editors offer Resume editor.",
        );
        return false;
      } finally {
        release();
      }
    },
    [beginCommand, report],
  );
  /** Whole-account navigation finishes every retained editor before its tabs unmount. */
  const transition = useCallback(
    (action: () => void) =>
      barrier(ACCOUNT_COMMAND, async () => {
        const expected = new Map(panels.current);
        const retained = [...expected.values()];
        const assertOwners = () => {
          if (
            panels.current.size !== expected.size ||
            [...expected].some(([key, panel]) => panels.current.get(key)?.owner !== panel.owner)
          )
            throw new Error("Office surfaces changed during the save barrier.");
        };
        try {
          const prepared = await Promise.allSettled(
            retained.map((panel) => panel.prepareToLeave()),
          );
          if (prepared.some((result) => result.status === "rejected"))
            throw new Error("Office saves are unconfirmed.");
          assertOwners();
          // Only after ALL reversible holds succeeded may any editor become terminal.
          const committed = await Promise.allSettled(
            retained.map(async (panel) => panel.commitLeave?.()),
          );
          if (committed.some((result) => result.status === "rejected"))
            throw new Error("Office drains are unconfirmed.");
          assertOwners();
          action();
        } catch (error) {
          await Promise.allSettled(retained.map(async (panel) => panel.cancelLeave?.()));
          throw error;
        }
      }),
    [barrier, panels],
  );
  /** Closing one tab finishes only that tab's editor; other retained sessions keep running. */
  const leave = useCallback(
    (chatId: string, id: string) =>
      barrier(panelKey(chatId, id), async () => {
        const key = panelKey(chatId, id);
        const panel = panels.current.get(key);
        if (panel === undefined) return;
        try {
          await panel.prepareToLeave();
          if (panels.current.get(key)?.owner !== panel.owner)
            throw new Error("The Office surface changed while closing.");
          await panel.commitLeave?.();
          if (panels.current.get(key)?.owner !== panel.owner)
            throw new Error("The Office surface changed while closing.");
        } catch (error) {
          await panel.cancelLeave?.();
          throw error;
        }
      }),
    [barrier, panels],
  );
  /**
   * Send checkpoints the visible tab without ending editing. Explicit references keep their own
   * intent, so their descriptive context is best-effort and never blocks the Send.
   */
  const prepareSend = useCallback(
    async (chatId: string, explicitReferences: boolean): Promise<OfficeSendTarget | null> => {
      // Only the chat workspace actually on screen may describe a Send. A hidden chat's editor is
      // never promoted into context by a late selection change.
      const id =
        visible.current.showing && visible.current.chatId === chatId
          ? selected.current?.chatId === chatId
            ? selected.current.id
            : null
          : null;
      if (id === null) return null;
      const panel = panels.current.get(panelKey(chatId, id));
      if (panel === undefined || panel.chatId !== chatId) {
        if (explicitReferences) return null;
        throw new Error("Office selection is not ready.");
      }
      const release = beginCommand(panelKey(chatId, id));
      if (release === null) {
        // An explicit reference never waits on descriptive context; a plain send still refuses.
        if (explicitReferences) return null;
        throw new Error("Finish the Office save before sending.");
      }
      try {
        const target = await panel.prepareSend();
        // Switching chats only hides this editor; the frozen observation stays this panel's own.
        if (panels.current.get(panelKey(chatId, id))?.owner !== panel.owner)
          throw new Error("The Office surface changed before Send.");
        return target;
      } catch (error) {
        // Opened files and selected cells only describe Send; they never fail an explicit request.
        if (explicitReferences) return null;
        throw error;
      } finally {
        release();
      }
    },
    [beginCommand, panels, selected, visible],
  );
  return { transition, leave, prepareSend };
}
