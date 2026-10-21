/**
 * Atomic promotion of one reserved skill version.
 *
 * Manifest, head, current file, version state and upload state are written in
 * one synchronous transaction; any lost fence or failed write throws so the
 * whole publication rolls back and no half-published snapshot can be read.
 *
 * The UPDATE fences return the exact changed row and compare its identity.
 * `rowsWritten` is a billing count that also counts index-row updates (the
 * `skill_versions_state_idx` entry is updated when `state` changes), so it
 * cannot prove an exact one-row fence.
 */
import type { SkillManifest } from "./skills-model.ts";
import type { SkillFileRow, SkillStorage, SkillUploadRow } from "./skills-rows.ts";

export type CommitPublicationInput = {
  readonly storage: SkillStorage;
  readonly upload: SkillUploadRow;
  readonly uploadId: string;
  readonly nameKey: string;
  readonly current: SkillFileRow | null;
  readonly manifest: SkillManifest;
  readonly now: number;
};

type FileFenceRow = { readonly id: string; readonly version: string };
type VersionFenceRow = {
  readonly version: string;
  readonly state: string;
  readonly upload_id: string;
};
type UploadFenceRow = {
  readonly upload_id: string;
  readonly state: string;
  readonly version: string;
};

export const commitPublication = (input: CommitPublicationInput): void => {
  const { storage, upload, uploadId, nameKey, current, manifest, now } = input;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO skill_manifests (revision, document, created_at) VALUES (?, ?, ?)`,
      manifest.revision,
      JSON.stringify(manifest),
      now,
    );
    storage.sql.exec(
      `INSERT INTO skill_head (id, revision) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET revision = excluded.revision`,
      manifest.revision,
    );
    if (current === null) {
      storage.sql.exec(
        `INSERT INTO skill_files (id, filename, name_key, version, digest, byte_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        upload.skill_id,
        upload.filename,
        nameKey,
        upload.version,
        upload.digest,
        upload.byte_size,
        now,
        now,
      );
    } else {
      const rows = storage.sql
        .exec<FileFenceRow>(
          `UPDATE skill_files SET filename = ?, version = ?, digest = ?, byte_size = ?, updated_at = ?
           WHERE name_key = ? AND version = ?
           RETURNING id, version`,
          upload.filename,
          upload.version,
          upload.digest,
          upload.byte_size,
          now,
          nameKey,
          upload.replace_version,
        )
        .toArray();
      const row = rows[0];
      if (
        rows.length !== 1 ||
        row === undefined ||
        row.id !== upload.skill_id ||
        row.version !== upload.version
      )
        throw new Error("skill file fence lost");
    }
    const versions = storage.sql
      .exec<VersionFenceRow>(
        `UPDATE skill_versions SET state = 'published', published_at = ?, published_revision = ?
         WHERE version = ? AND state = 'reserved'
         RETURNING version, state, upload_id`,
        now,
        manifest.revision,
        upload.version,
      )
      .toArray();
    const versionRow = versions[0];
    if (
      versions.length !== 1 ||
      versionRow === undefined ||
      versionRow.version !== upload.version ||
      versionRow.state !== "published" ||
      versionRow.upload_id !== uploadId
    )
      throw new Error("skill publication fence lost");
    const uploads = storage.sql
      .exec<UploadFenceRow>(
        `UPDATE skill_uploads SET state = 'published', revision = ?, updated_at = ?
         WHERE upload_id = ? AND state = 'pending'
         RETURNING upload_id, state, version`,
        manifest.revision,
        now,
        uploadId,
      )
      .toArray();
    const uploadRow = uploads[0];
    if (
      uploads.length !== 1 ||
      uploadRow === undefined ||
      uploadRow.upload_id !== uploadId ||
      uploadRow.state !== "published" ||
      uploadRow.version !== upload.version
    )
      throw new Error("skill publication fence lost");
  });
};
