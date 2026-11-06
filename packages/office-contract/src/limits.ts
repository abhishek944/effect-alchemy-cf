import { Schema } from "effect";

/** Execution/lifetime policies only. Content capacity is owned by actual platform/protocol bounds. */
export const OFFICE_LIMITS = Object.freeze({
  jobsPerDocument: 1,
  cachedUnits: 2,
  cacheTtlSeconds: 300,
  jobSeconds: 600,
  documentUnitsPerDraft: 1,
});
const positive = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
export const OfficeLimits = Schema.Struct({
  jobsPerDocument: positive,
  cachedUnits: positive,
  cacheTtlSeconds: positive,
  jobSeconds: positive,
  documentUnitsPerDraft: Schema.Literal(1),
});
export type OfficeLimits = typeof OfficeLimits.Type;
