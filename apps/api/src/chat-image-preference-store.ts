import type { AgentContext } from "agents";
import { Schema } from "effect";
import {
  ImagePreferences,
  ImagePreferencesWrite,
  initialImagePreferences,
  type ImagePreferencesView,
} from "./chat-image-preference-schema.ts";

export type ImagePreferencesWriteResult =
  | { readonly ok: true; readonly value: ImagePreferencesView }
  | { readonly ok: false; readonly code: "revision_conflict" };

/** Owner-actor singleton. Reads and writes never perform image work. */
export class ChatImagePreferencesStore {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS chat_image_preferences (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL
    )`);
  }

  /** Missing means defaults; malformed existing data is an error, never a reset. */
  read(): ImagePreferencesView {
    const row = this.storage.sql
      .exec<{ value: string }>("SELECT value FROM chat_image_preferences WHERE singleton = 1")
      .toArray()[0];
    if (row === undefined) return { preferences: initialImagePreferences(), source: "default" };
    const raw: unknown = JSON.parse(row.value);
    return { preferences: Schema.decodeUnknownSync(ImagePreferences)(raw), source: "explicit" };
  }

  /** A successful explicit write advances the revision exactly once, including no-op choices. */
  write(input: ImagePreferencesWrite): ImagePreferencesWriteResult {
    const valid = Schema.decodeUnknownSync(ImagePreferencesWrite)(input);
    return this.storage.transactionSync(() => {
      const current = this.read().preferences;
      if (
        current.revision !== valid.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        return { ok: false, code: "revision_conflict" };
      const preferences: ImagePreferences = {
        version: 1,
        revision: current.revision + 1,
        model: valid.model,
        size: valid.size,
        quality: valid.quality,
      };
      this.storage.sql.exec(
        `INSERT INTO chat_image_preferences (singleton, value) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET value = excluded.value`,
        JSON.stringify(preferences),
      );
      return { ok: true, value: { preferences, source: "explicit" } };
    });
  }
}
