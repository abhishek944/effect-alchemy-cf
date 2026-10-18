/**
 * Account theme commands: one frozen apply or Undo per accepted operation, applied
 * at most once with its terminal outcome stored as a receipt in the same
 * transaction as the theme change. Undo consumes only its own chat's pointer and
 * only while that target is still current; manual writes never own a pointer.
 */
import type { AgentContext } from "agents";
import { ThemeReceipts } from "./theme-receipts.ts";
import { ThemeRecord } from "./theme-record.ts";
import { undoThemeCommand } from "./theme-undo.ts";
import {
  fingerprintOf,
  type AccountTheme,
  type ActionId,
  type ActionReceipt,
  type FrozenApply,
  type FrozenUndo,
  type ManualThemeWrite,
  type ThemeActionOutcome,
  type ThemeOrigin,
  type ThemeResolution,
} from "./theme-model.ts";

type CommandResult = { readonly receipt: ActionReceipt; readonly current: AccountTheme };

const conflict = (current: AccountTheme, message: string): ThemeActionOutcome => ({
  ok: false,
  code: "revision_conflict",
  currentTheme: current.theme,
  currentRevision: current.revision,
  message,
});

export class ThemeStore {
  private readonly storage: AgentContext["storage"];
  private readonly record: ThemeRecord;
  private readonly receipts: ThemeReceipts;

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    this.record = new ThemeRecord(storage);
    this.receipts = new ThemeReceipts(storage);
  }

  read(): AccountTheme {
    return this.record.read();
  }

  writeManual(input: ManualThemeWrite): ThemeResolution<AccountTheme> {
    return this.record.writeManual(input);
  }

  receipt(actionId: ActionId): ActionReceipt | null {
    return this.receipts.get(actionId);
  }

  undoTarget(origin: ThemeOrigin): ThemeResolution<ReturnType<ThemeReceipts["target"]>> {
    return { ok: true, value: this.receipts.target(origin) };
  }

  canUndo(): boolean {
    return this.receipts.hasAnyTarget();
  }

  /** One frozen apply, stored with its terminal receipt. */
  apply(command: FrozenApply, origin: ThemeOrigin, now: number): ThemeResolution<CommandResult> {
    return this.storage.transactionSync(() => {
      const fingerprint = fingerprintOf(command);
      const existing = this.receipts.get(command.actionId);
      if (existing !== null) {
        if (existing.fingerprint !== fingerprint || existing.origin !== origin)
          return { ok: false, code: "invalid_input" };
        return { ok: true, value: { receipt: existing, current: this.record.read() } };
      }
      const current = this.record.read();
      const before = { theme: current.theme, revision: current.revision };
      if (
        current.revision !== command.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      ) {
        const receipt: ActionReceipt = {
          actionId: command.actionId,
          fingerprint,
          origin,
          before,
          result: conflict(
            current,
            "The account theme changed after this request was prepared, so nothing was overwritten. Ask again to change it.",
          ),
        };
        this.receipts.put(receipt, now);
        return { ok: true, value: { receipt, current } };
      }
      if (current.theme === command.theme) {
        // Establish an explicit default choice to prevent later local migration,
        // but no visual change means no new Undo pointer.
        const established: AccountTheme =
          current.source === "account"
            ? current
            : {
                ...current,
                source: "account",
                revision: current.revision + 1,
              };
        if (established !== current) this.record.put(established);
        const receipt: ActionReceipt = {
          actionId: command.actionId,
          fingerprint,
          origin,
          before,
          result: {
            ok: true,
            code: "unchanged",
            changed: false,
            theme: established.theme,
            revision: established.revision,
          },
        };
        this.receipts.put(receipt, now);
        return { ok: true, value: { receipt, current: established } };
      }
      const record: AccountTheme = {
        version: 1,
        revision: current.revision + 1,
        theme: command.theme,
        source: "account",
        previous: null,
      };
      this.record.put(record);
      const receipt: ActionReceipt = {
        actionId: command.actionId,
        fingerprint,
        origin,
        before,
        result: {
          ok: true,
          code: "saved",
          changed: true,
          theme: record.theme,
          revision: record.revision,
        },
      };
      this.receipts.put(receipt, now);
      this.receipts.setTarget(
        origin,
        {
          targetActionId: command.actionId,
          expectedRevision: record.revision,
          theme: record.theme,
        },
        now,
      );
      return { ok: true, value: { receipt, current: record } };
    });
  }

  undo(command: FrozenUndo, origin: ThemeOrigin, now: number): ThemeResolution<CommandResult> {
    return undoThemeCommand(this.storage, this.record, this.receipts, command, origin, now);
  }
}
