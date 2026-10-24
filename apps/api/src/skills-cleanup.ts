/**
 * Bounded retirement for abandoned, unpublished skill versions.
 *
 * A reservation holds quota and protects its object until this job claims it
 * into the non-publishable `retiring` state and permanently tombstones its
 * upload intent. The version key is then overwritten with a zero-byte marker
 * (never deleted), so a late or replayed create-once PUT cannot resurrect
 * original bytes, and the upload id can never be reused for new content.
 * Original-byte quota is released only after the marker is confirmed. Published
 * versions and their objects are never selected, so pinned originals survive.
 */
import type * as cf from "@cloudflare/workers-types";
import { reportFailure } from "@starter/diagnostics";
import { retireSkillObject } from "./skills-objects.ts";
import { skillVersionRow, type SkillStorage, type SkillVersionRow } from "./skills-rows.ts";

export const SKILL_RESERVED_TTL_MS = 86_400_000;
const CLEANUP_BATCH = 16;

type CleanupInput = {
  readonly storage: SkillStorage;
  readonly scope: string;
  readonly bucket: cf.R2Bucket;
  readonly now: number;
};

type Claimed = {
  readonly version: string;
  readonly uploadId: string;
};

/**
 * Claims one version for retirement in a single transaction. A due `reserved`
 * row becomes `retiring`; a `retiring` row is returned for a marker retry. The
 * upload intent becomes a permanent `expired` tombstone at claim time so no
 * reserve or publish can act on it while the marker is being written.
 */
const claim = (
  storage: SkillStorage,
  version: string,
  cutoff: number,
  now: number,
): Claimed | null =>
  storage.transactionSync(() => {
    const row: SkillVersionRow | null = skillVersionRow(storage, version);
    if (row === null || row.state === "published" || row.state === "expired") return null;
    if (row.state === "reserved") {
      if (row.created_at > cutoff) return null;
      storage.sql.exec(
        `UPDATE skill_versions SET state = 'retiring' WHERE version = ? AND state = 'reserved'`,
        version,
      );
    }
    storage.sql.exec(
      `UPDATE skill_uploads SET state = 'expired', updated_at = ?
       WHERE upload_id = ? AND state = 'pending'`,
      now,
      row.upload_id,
    );
    return { version: row.version, uploadId: row.upload_id };
  });

export const cleanupSkillVersions = async (input: CleanupInput): Promise<void> => {
  const cutoff = input.now - SKILL_RESERVED_TTL_MS;
  const candidates = input.storage.sql
    .exec<{ version: string }>(
      `SELECT version FROM skill_versions
       WHERE (state = 'reserved' AND created_at <= ?) OR state = 'retiring'
       ORDER BY created_at LIMIT ?`,
      cutoff,
      CLEANUP_BATCH,
    )
    .toArray();
  for (const candidate of candidates) {
    const claimed = claim(input.storage, candidate.version, cutoff, input.now);
    if (claimed === null) continue;
    try {
      await retireSkillObject(input.bucket, input.scope, claimed.version);
    } catch (cause) {
      reportFailure(cause, {
        component: "skills",
        operation: "cleanup.retire",
        phase: "object",
        reason: "skills_retire_failed",
        operationId: claimed.uploadId,
        event: "application.cleanup",
      });
      continue;
    }
    input.storage.transactionSync(() => {
      input.storage.sql.exec(
        `UPDATE skill_versions SET state = 'expired', byte_size = 0
         WHERE version = ? AND state = 'retiring'`,
        claimed.version,
      );
    });
  }
  // Defensive tombstone for a pending intent whose version row is already gone.
  input.storage.sql.exec(
    `UPDATE skill_uploads SET state = 'expired', updated_at = ?
     WHERE upload_id IN (
       SELECT upload_id FROM skill_uploads
       WHERE state = 'pending' AND created_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM skill_versions WHERE skill_versions.upload_id = skill_uploads.upload_id
         )
       LIMIT ?
     )`,
    input.now,
    cutoff,
    CLEANUP_BATCH,
  );
};
