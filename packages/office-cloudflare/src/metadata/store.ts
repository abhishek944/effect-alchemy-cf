import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";
import {
  OfficeConflict,
  OfficeForbidden,
  OfficeInvalid,
  OfficeLimited,
  OfficeNotFound,
  OfficeUnavailable,
  OfficeErrors,
  OFFICE_LIMITS,
  OfficeLimits,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import type { ErrorCode, OfficeError } from "@starter/office-contract";
import { OwnerClaims } from "@starter/office-server/ports";
import type { OwnerScope, Store } from "@starter/office-server/ports";

export interface OfficeProviderOptions {
  readonly database: D1Database;
  readonly bucket: R2Bucket;
  readonly stage: string;
  readonly workerId?: string;
  readonly limits?: OfficeLimits;
  readonly editorTtlMs?: number;
  readonly orphanGraceMs?: number;
}
export type Statement = readonly [sql: string, values: readonly (string | number | null)[]];
export const sqlNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const conflict = (code: ErrorCode = "IDEMPOTENCY_CONFLICT") =>
  new OfficeConflict(safeFailure(code));
export const invalid = () => new OfficeInvalid(safeFailure("INVALID_INPUT"));
export const missing = () => new OfficeNotFound(safeFailure("NOT_FOUND"));
export function failure(cause: unknown): OfficeError {
  if (OfficeErrors.some((ErrorType) => cause instanceof ErrorType)) {
    // Foreign exceptions never cross the port; these are the shared tagged error constructors.
    const parsed = Schema.decodeUnknownSync(Schema.Union(OfficeErrors))(cause);
    return parsed;
  }
  return new OfficeUnavailable(safeFailure("UNAVAILABLE"));
}
export const storeEffect = <A>(body: () => Promise<A>): Store<A> =>
  Effect.tryPromise({ try: body, catch: failure });
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw invalid();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return item;
  });
}
export class MetadataStore {
  readonly options: OfficeProviderOptions;
  readonly limits: OfficeLimits;
  readonly workerId: string | null;
  constructor(options: OfficeProviderOptions) {
    this.options = Object.freeze({ ...options });
    this.limits = decodeWireSync(OfficeLimits)(options.limits ?? OFFICE_LIMITS);
    this.workerId = options.workerId ?? null;
    if (
      !options.stage ||
      options.stage.length > 256 ||
      (this.workerId !== null && (!this.workerId || this.workerId.length > 256))
    )
      throw invalid();
  }
  owner(input: OwnerScope): string {
    const owner = decodeWireSync(OwnerClaims)(input);
    if (owner.stage !== this.options.stage) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    return canonical([owner.stage, owner.ownerId]);
  }
  native(owner: OwnerScope, documentId: string, unitId: string): string {
    this.owner(owner);
    return canonical([owner.stage, owner.ownerId, documentId, unitId]);
  }
  encode(schema: Schema.ConstraintDecoder<unknown>, value: unknown): string {
    const parsed = decodeWireSync(schema)(value);
    const text = canonical(parsed);
    if (new TextEncoder().encode(text).length > this.limits.metadataBytes)
      throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
    return text;
  }
  decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, text: string): S["Type"] {
    if (new TextEncoder().encode(text).length > this.limits.metadataBytes)
      throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
    try {
      return decodeWireSync(Schema.fromJsonString(schema))(text);
    } catch {
      throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
    }
  }
  async hash(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonical(value));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  first<T>(sql: string, values: readonly (string | number | null)[] = []): Promise<T | null> {
    return this.options.database
      .withSession("first-primary")
      .prepare(sql)
      .bind(...values)
      .first<T>();
  }
  async all<T>(sql: string, values: readonly (string | number | null)[] = []): Promise<T[]> {
    return (
      await this.options.database
        .withSession("first-primary")
        .prepare(sql)
        .bind(...values)
        .all<T>()
    ).results;
  }
  async write(
    predicate: string,
    values: readonly (string | number | null)[],
    statements: readonly Statement[],
    code: ErrorCode = "NATIVE_CONFLICT",
  ): Promise<void> {
    const token = crypto.randomUUID();
    const db = this.options.database;
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO office_meta_guard VALUES(?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`,
          )
          .bind(token, ...values),
        ...statements.map(([sql, args]) => db.prepare(sql).bind(...args)),
        db.prepare("DELETE FROM office_meta_guard WHERE token=?").bind(token),
      ]);
    } catch (cause) {
      if (String(cause).includes("office_metadata_guard")) throw conflict(code);
      throw cause;
    }
  }
}
