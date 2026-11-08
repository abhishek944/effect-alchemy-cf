import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * Durable-Object-shaped SQL cursor. The chat stores already read results with
 * `toArray()` and `one()`, so keeping those members keeps 100+ call sites
 * unchanged while the storage engine moves to `node:sqlite`.
 */
export interface SqlCursor<Row> {
  /** Rows changed by a mutation; zero for a query. */
  readonly rowsWritten: number;
  toArray(): Row[];
  one(): Row;
}

const cursor = <Row>(rows: Row[], rowsWritten = 0): SqlCursor<Row> => ({
  rowsWritten,
  toArray: () => rows,
  one: () => {
    const [first] = rows;
    if (first === undefined) throw new Error("SQL query returned no rows");
    return first;
  },
});

/**
 * One synchronous SQLite database per chat object. `node:sqlite` is fully
 * synchronous, which is what the previous Durable Object SQL API was, so
 * `transactionSync` keeps its exact callback shape and ordering guarantee.
 */
export class SqlClient {
  readonly #database: DatabaseSync;
  #depth = 0;

  constructor(location: string) {
    this.#database = new DatabaseSync(location);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  get database(): DatabaseSync {
    return this.#database;
  }

  exec<Row = unknown>(sql: string, ...params: readonly SQLInputValue[]): SqlCursor<Row> {
    const statement = this.#database.prepare(sql);
    if (!statement.columns().length) {
      const result = statement.run(...params);
      return cursor<Row>([], Number(result.changes));
    }
    // node:sqlite returns untyped row records; the Row parameter is the caller's
    // declared schema for a query this module already executed.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed projection of a decoded row record
    return cursor<Row>(statement.all(...params) as unknown as Row[]);
  }

  run(sql: string, ...params: readonly SQLInputValue[]): void {
    this.prepare(sql).run(...params);
  }

  prepare(sql: string): StatementSync {
    return this.#database.prepare(sql);
  }

  /**
   * Runs `fn` inside one transaction. Nested calls use savepoints so an outer
   * failure still rolls back everything the caller wrote.
   */
  transactionSync<T>(fn: () => T): T {
    const nested = this.#depth > 0;
    const name = `sp_${this.#depth}`;
    this.#database.exec(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
    this.#depth += 1;
    try {
      const result = fn();
      this.#database.exec(nested ? `RELEASE ${name}` : "COMMIT");
      return result;
    } catch (error) {
      this.#database.exec(nested ? `ROLLBACK TO ${name}` : "ROLLBACK");
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }

  close(): void {
    this.#database.close();
  }
}
