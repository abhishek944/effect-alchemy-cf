/**
 * The revisioned account theme value itself.
 *
 * Only this module writes the stored record. Manual browser/device writes go
 * through `writeManualTheme`, which keeps the revision guard and the same-theme
 * no-op but never creates or replaces a chat-scoped Undo target: only a frozen
 * chat command can own one.
 */
import type { AgentContext } from "agents";
import { decodeOption } from "./chat-internal.ts";
import {
  AccountTheme,
  initialAccountTheme,
  type ManualThemeWrite,
  type ThemeResolution,
} from "./theme-model.ts";

export class ThemeRecord {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS account_theme (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
  }

  read(): AccountTheme {
    const row = this.storage.sql
      .exec<{ value: string }>(`SELECT value FROM account_theme WHERE key = 'theme'`)
      .toArray()[0];
    if (row === undefined) return initialAccountTheme();
    const raw: unknown = JSON.parse(row.value);
    const parsed = decodeOption(AccountTheme, raw);
    if (parsed === null) throw new Error("Stored account theme is invalid");
    return parsed;
  }

  put(record: AccountTheme): void {
    this.storage.sql.exec(
      `INSERT INTO account_theme (key, value) VALUES ('theme', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(record),
    );
  }

  /** Revision-guarded manual/device write; a same-theme write is a no-op. */
  writeManual(input: ManualThemeWrite): ThemeResolution<AccountTheme> {
    return this.storage.transactionSync(() => {
      const current = this.read();
      if (
        current.revision !== input.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        return { ok: false, code: "revision_conflict" };
      if (current.source === "account" && current.theme === input.theme)
        return { ok: true, value: current };
      const record: AccountTheme = {
        version: 1,
        revision: current.revision + 1,
        theme: input.theme,
        source: "account",
        previous: null,
      };
      this.put(record);
      return { ok: true, value: record };
    });
  }
}
