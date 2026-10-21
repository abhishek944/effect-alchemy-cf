import { Schema } from "effect";

const MiB = 1024 * 1024;
/** Hard ceilings are not a document-capacity promise. Raising them needs acceptance evidence. */
export const OFFICE_LIMIT_CEILINGS = Object.freeze({
  metadataBytes: 16 * 1024,
  uploadBytes: 25 * MiB,
  codeBytes: 128 * 1024,
  nativeBytes: 256 * MiB,
  proposalBytes: 8 * MiB,
  mutationCount: 20_000,
  blockBytes: 8 * MiB,
  blockCount: 16_384,
  responseBytes: 256 * 1024,
  renderBytes: 64 * MiB,
  renderPages: 32,
  renderPixels: 64_000_000,
  queueDepth: 32,
  jobsPerDocument: 2,
  cachedUnits: 4,
  cacheTtlSeconds: 1800,
  jobSeconds: 120,
  historyScanRevisions: 16_384,
  documentUnitsPerDraft: 1,
});
export const OFFICE_LIMITS = Object.freeze({
  metadataBytes: 16 * 1024,
  uploadBytes: 10 * MiB,
  codeBytes: 32 * 1024,
  nativeBytes: 128 * MiB,
  proposalBytes: 2 * MiB,
  mutationCount: 5000,
  blockBytes: 2 * MiB,
  blockCount: 4096,
  responseBytes: 64 * 1024,
  renderBytes: 16 * MiB,
  renderPages: 8,
  renderPixels: 16_000_000,
  queueDepth: 8,
  jobsPerDocument: 1,
  cachedUnits: 2,
  cacheTtlSeconds: 300,
  jobSeconds: 60,
  historyScanRevisions: 4096,
  documentUnitsPerDraft: 1,
});
const cap = (max: number) =>
  Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(max),
  );
export const OfficeLimits = Schema.Struct({
  metadataBytes: cap(OFFICE_LIMIT_CEILINGS.metadataBytes),
  uploadBytes: cap(OFFICE_LIMIT_CEILINGS.uploadBytes),
  codeBytes: cap(OFFICE_LIMIT_CEILINGS.codeBytes),
  nativeBytes: cap(OFFICE_LIMIT_CEILINGS.nativeBytes),
  proposalBytes: cap(OFFICE_LIMIT_CEILINGS.proposalBytes),
  mutationCount: cap(OFFICE_LIMIT_CEILINGS.mutationCount),
  blockBytes: cap(OFFICE_LIMIT_CEILINGS.blockBytes),
  blockCount: cap(OFFICE_LIMIT_CEILINGS.blockCount),
  responseBytes: cap(OFFICE_LIMIT_CEILINGS.responseBytes),
  renderBytes: cap(OFFICE_LIMIT_CEILINGS.renderBytes),
  renderPages: cap(OFFICE_LIMIT_CEILINGS.renderPages),
  renderPixels: cap(OFFICE_LIMIT_CEILINGS.renderPixels),
  queueDepth: cap(OFFICE_LIMIT_CEILINGS.queueDepth),
  jobsPerDocument: cap(OFFICE_LIMIT_CEILINGS.jobsPerDocument),
  cachedUnits: cap(OFFICE_LIMIT_CEILINGS.cachedUnits),
  cacheTtlSeconds: cap(OFFICE_LIMIT_CEILINGS.cacheTtlSeconds),
  jobSeconds: cap(OFFICE_LIMIT_CEILINGS.jobSeconds),
  historyScanRevisions: cap(OFFICE_LIMIT_CEILINGS.historyScanRevisions),
  documentUnitsPerDraft: Schema.Literal(1),
});
export type OfficeLimits = typeof OfficeLimits.Type;
