import { useCallback, type RefObject } from "react";
import type { OfficeSendTarget } from "@starter/office-contract";

export type OfficePanelGuard = {
  readonly chatId: string;
  readonly owner: object;
  readonly readOnly?: boolean;
  readonly prepareToLeave: () => Promise<void>;
  readonly prepareSend: () => Promise<OfficeSendTarget | null>;
};
type Options = {
  beginCommand: () => (() => void) | null;
  report: (message: string) => void;
  panels: RefObject<Map<string, OfficePanelGuard>>;
  selected: RefObject<string | null>;
  visible: RefObject<boolean>;
};

/**
 * Destructive Office commands share one gate: one runs at a time and only after the affected
 * native editor acknowledged its save. Ordinary tab focus never enters this gate.
 */
export function useOfficeBarriers({ beginCommand, report, panels, selected, visible }: Options) {
  const barrier = useCallback(
    async (action: () => void | Promise<void>): Promise<boolean> => {
      const release = beginCommand();
      if (release === null) {
        report("Finishing an Office save. Keep the editor open and try again.");
        return false;
      }
      report("");
      try {
        await action();
        return true;
      } catch {
        report(
          "Office input or saves are unconfirmed. The editor stays open; finish composition or retry saving.",
        );
        return false;
      } finally {
        release();
      }
    },
    [beginCommand, report],
  );
  /** Whole-workspace navigation finishes every retained editor before its tabs unmount. */
  const transition = useCallback(
    (action: () => void) =>
      barrier(async () => {
        const expected = new Map(panels.current);
        const results = await Promise.allSettled(
          [...expected.values()].map((panel) =>
            Promise.resolve().then(() => panel.prepareToLeave()),
          ),
        );
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Office saves are unconfirmed.");
        // Resolution may register a new panel owner while saves were awaited; retain tabs.
        const current = panels.current;
        if (
          current.size !== expected.size ||
          [...expected].some(([id, panel]) => current.get(id)?.owner !== panel.owner)
        )
          throw new Error("Office surfaces changed during the save barrier.");
        action();
      }),
    [barrier, panels],
  );
  /** Closing one tab finishes only that tab's editor; other retained sessions keep running. */
  const leave = useCallback(
    (id: string) =>
      barrier(async () => {
        const panel = panels.current.get(id);
        if (panel === undefined) return;
        await panel.prepareToLeave();
        if (panels.current.get(id)?.owner !== panel.owner)
          throw new Error("The Office surface changed while closing.");
      }),
    [barrier, panels],
  );
  /** Send freezes only the visible tab's exact held save. Explicit references carry their own intent. */
  const prepareSend = useCallback(
    async (chatId: string, explicitReferences: boolean): Promise<OfficeSendTarget | null> => {
      if (explicitReferences) return null;
      const id = visible.current ? selected.current : null;
      if (id === null) return null;
      const panel = panels.current.get(id);
      if (panel === undefined || panel.chatId !== chatId)
        throw new Error("Office selection is not ready.");
      const release = beginCommand();
      if (release === null) throw new Error("Finish the Office save before sending.");
      try {
        const target = await panel.prepareSend();
        if (panels.current.get(id)?.owner !== panel.owner || selected.current !== id)
          throw new Error("Office selection changed before Send.");
        return target;
      } finally {
        release();
      }
    },
    [beginCommand, panels, selected, visible],
  );
  return { transition, leave, prepareSend };
}
