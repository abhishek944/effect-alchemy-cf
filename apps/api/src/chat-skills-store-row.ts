/** Persisted attempt row shape and its strict Effect decoding. */
import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { SkillActiveEntry } from "./chat-skills-document.ts";
import { SkillManifest } from "./skills-model.ts";

export const SkillAttemptStatus = Schema.Literals([
  "prepared",
  "accepted",
  "incomplete",
  "unavailable",
  "released",
]);
export type SkillAttemptStatus = typeof SkillAttemptStatus.Type;

const ActiveList = Schema.Array(SkillActiveEntry);
const StoredManifest = Schema.NullOr(SkillManifest);
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export type SkillAttemptRow = {
  readonly attemptId: string;
  readonly operationId: string;
  readonly logicalOperationId: string;
  readonly retryOf: string | null;
  readonly retryKey: string | null;
  readonly pin: SkillManifest | null;
  readonly status: SkillAttemptStatus;
  readonly failure: string | null;
  readonly catalog: string | null;
  readonly catalogDigest: string | null;
  readonly active: readonly (typeof SkillActiveEntry.Type)[];
  readonly content: string | null;
  readonly classification: "library" | "legacy" | null;
  /** True when persisted JSON failed decoding; callers must fail closed. */
  readonly corrupt: boolean;
  /** False once the original bytes are proven unavailable; null while unknown. */
  readonly recoverable: boolean | null;
  readonly recoveryReason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type SkillAttemptDbRow = {
  attempt_id: string;
  operation_id: string;
  logical_operation_id: string;
  retry_of: string | null;
  retry_key: string | null;
  pin: string | null;
  status: string;
  failure: string | null;
  catalog: string | null;
  catalog_digest: string | null;
  active: string | null;
  content: string | null;
  classification: string | null;
  recoverable: number | null;
  recovery_reason: string | null;
  created_at: number;
  updated_at: number;
};

const parse = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  raw: string | null,
): S["Type"] | null => {
  if (raw === null) return null;
  try {
    return decodeOption(schema, JSON.parse(raw));
  } catch {
    return null;
  }
};

export const decodeAttemptRow = (row: SkillAttemptDbRow): SkillAttemptRow => {
  const status = decodeOption(SkillAttemptStatus, row.status);
  const pin = parse(StoredManifest, row.pin);
  const active = parse(ActiveList, row.active);
  const catalogDigest =
    row.catalog_digest === null || decodeOption(Digest, row.catalog_digest) !== null
      ? row.catalog_digest
      : null;
  // A library row always carries catalog and active JSON; NULL/nullable only for
  // a positively classified legacy row, which callers never render.
  const libraryRow = row.classification !== "legacy";
  const corrupt =
    status === null ||
    (libraryRow && (row.catalog === null || row.active === null)) ||
    (row.pin !== null && pin === null) ||
    (row.active !== null && active === null) ||
    (row.catalog_digest !== null && catalogDigest === null);
  return {
    attemptId: row.attempt_id,
    operationId: row.operation_id,
    logicalOperationId: row.logical_operation_id,
    retryOf: row.retry_of,
    retryKey: row.retry_key,
    pin,
    status: status ?? "unavailable",
    failure: row.failure,
    catalog: row.catalog,
    catalogDigest,
    active: active ?? [],
    content: row.content,
    classification:
      row.classification === "library" || row.classification === "legacy"
        ? row.classification
        : null,
    corrupt,
    recoverable: row.recoverable === null ? null : row.recoverable === 1,
    recoveryReason: row.recovery_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};
