import { Schema } from "effect";
import {
  ArtifactKind,
  ArtifactRef,
  Count,
  Digest,
  Id,
  OfficeUnavailable,
  safeFailure,
} from "@starter/office-contract";
import type { OfficeBytes } from "@starter/office-server/ports";

// Bounds durable uncertainty markers per immutable owner/ID, including crashed upload attempts.
export const MAX_ATTEMPTS = 32;
export type PutInput = Parameters<OfficeBytes["put"]>[1];
export const PutMetadata = Schema.Struct({
  id: Id,
  kind: ArtifactKind,
  mediaType: ArtifactRef.fields.mediaType,
  declaredBytes: Count,
  expectedDigest: Schema.NullOr(Digest),
});
export const Pending = Schema.Struct({
  id: Id,
  kind: ArtifactKind,
  mediaType: ArtifactRef.fields.mediaType,
  bytes: Count,
});
export type RefRow = { key: string; created: number; state: string; record: string };
export type ObjectRow = {
  key: string;
  state: string;
  digest: string | null;
  bytes: number | null;
  etag: string | null;
};
export const unknownOutcome = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
export const missingContent = () => new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
export function assertKey(prefix: string, id: string, key: string): void {
  const base = `${prefix}${id}/`;
  if (
    !key.startsWith(base) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key.slice(base.length),
    )
  )
    throw missingContent();
}
