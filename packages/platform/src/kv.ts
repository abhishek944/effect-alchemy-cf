import { Schema } from "effect";
import type { SqlClient } from "./sql.ts";

const Stored = Schema.Struct({ value: Schema.String });

/**
 * Durable-Object-shaped per-object key/value storage. Values round-trip
 * through JSON, which is what the previous API already stored: owner ids,
 * opaque list cursors and plain usage records.
 */
export class KeyValueStore {
  readonly #sql: SqlClient;

  constructor(sql: SqlClient) {
    this.#sql = sql;
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS object_key_value (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const [row] = this.#sql
      .exec<typeof Stored.Type>(`SELECT value FROM object_key_value WHERE key = ?`, key)
      .toArray();
    if (row === undefined) return undefined;
    // Persisted JSON is the caller's declared value schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- decoded caller-owned value
    return JSON.parse(row.value) as T;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.#sql.exec(
      `INSERT INTO object_key_value (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      JSON.stringify(value),
    );
  }

  async delete(key: string): Promise<boolean> {
    this.#sql.exec(`DELETE FROM object_key_value WHERE key = ?`, key);
    return true;
  }
}
